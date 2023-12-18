import { Request, RequestHandler } from 'express';
import Parse from 'parse/node';
import Stripe from 'stripe';

import { getDate, stripe } from './stripe';
import { getOrNewStripeObj } from './utils/parse';

async function getStripeEvent(req: Request): Promise<Stripe.Event> {
  const sig = req.headers['stripe-signature'];
  if (!sig) throw new Error('request missing stripe-signature');

  return stripe.webhooks.constructEvent(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

const relevantEvents = new Set([
  'product.created',
  'product.updated',
  'price.created',
  'price.updated',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const webhookHandler: RequestHandler = async (req, res) => {
  try {
    const event = await getStripeEvent(req);

    console.log(`🔔  Received event: ${event.id} type: ${event.type}`);

    if (!relevantEvents.has(event.type)) return res.json({ received: true });

    await handleEvent(event);
    res.json({ received: true });
  } catch (error: any) {
    console.error(`❌ Error: ${error.stack ?? error.message}`);
    return res.status(400).json(`Webhook Error: ${error.message}`);
  }
};
export default webhookHandler;

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'product.created':
    case 'product.updated':
      await upsertProduct(event.data.object);
      break;
    case 'product.deleted':
      const productQuery = new Parse.Query('Prouduct');
      try {
        // here you put the objectId that you want to delete
        const object = await productQuery.get(event.data.object.id);
        try {
          const response: any = await object.destroy();
        } catch (error: any) {
          console.error('Error while deleting ParseObject', error);
        }
      } catch (error: any) {
        console.error('Error while retrieving ParseObject', error);
      }
      break;
    case 'price.created':
    case 'price.updated':
      await upsertPrice(event.data.object);
      break;
    case 'price.deleted':
      const priceQuery = new Parse.Query('Price');
      try {
        const object = await priceQuery.get(event.data.object.id);
        try {
          const response: any = await object.destroy();
        } catch (error: any) {
          console.error('Error while deleting ParseObject', error);
        }
      } catch (error: any) {
        console.error('Error while retrieving ParseObject', error);
      }

      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      await updateSubscription(event.data.object);
      break;
    }
    case 'checkout.session.completed': {
      const checkoutSession = event.data.object;
      if (checkoutSession.mode !== 'subscription') break;

      const subscription = await getSubscriptionFromCheckoutSession(
        checkoutSession
      );

      if (!checkoutSession.client_reference_id)
        throw new Error('Missing checkout.session.client_reference_id');
      await createSubscription(
        checkoutSession.client_reference_id,
        subscription
      );
      break;
    }
    default:
      throw new Error('Unhandled relevant event!');
  }
}

async function updateSubscription(subscription: Stripe.Subscription) {
  const subscriptionQuery = new Parse.Query('Subscription');
  subscriptionQuery.equalTo('stripeId', subscription.id);
  const dbSubscription = await subscriptionQuery.first({
    useMasterKey: true,
  });
  if (!dbSubscription) throw new Error('subscription not found in database');

  dbSubscription.set('stripeId', subscription.id);
  dbSubscription.set('status', subscription.status);
  dbSubscription.set('metadata', subscription.metadata);
  dbSubscription.set('cancelAtPeriodEnd', subscription.cancel_at_period_end);
  dbSubscription.set('created', getDate(subscription.created));
  dbSubscription.set(
    'currentPeriodStart',
    getDate(subscription.current_period_start)
  );
  dbSubscription.set(
    'currentPeriodEnd',
    getDate(subscription.current_period_end)
  );
  dbSubscription.set('endedAt', getDate(subscription.ended_at));
  dbSubscription.set('cancelAt', getDate(subscription.cancel_at));
  dbSubscription.set('canceledAt', getDate(subscription.canceled_at));
  await dbSubscription.save({ useMasterKey: true });
}

function getId(product: string | { id: string } | null) {
  if (!product) throw new Error('Missing id');
  return typeof product == 'string' ? product : product.id;
}

async function upsertProduct(data: Stripe.Product) {
  const product = await getOrNewStripeObj('Product', getId(data));
  product.set('active', data.active);
  product.set('name', data.name);
  product.set('metadata', data.metadata);
  await product.save({ useMasterKey: true });
}

async function upsertPrice(data: Stripe.Price) {
  const price = await getOrNewStripeObj('Price', getId(data));
  price.set('active', data.active);
  price.set('unitAmount', data.unit_amount);
  price.set('currency', data.currency);
  price.set('type', data.type);
  price.set('metadata', data.metadata);
  price.set('interval', data.recurring?.interval);
  price.set('intervalCount', data.recurring?.interval_count);
  await price.save({ useMasterKey: true });
}

type SubscriptionWithPlan = Stripe.Subscription & {
  plan: Stripe.Plan & { product: Stripe.Product };
};
async function getSubscriptionFromCheckoutSession({
  subscription,
}: Stripe.Checkout.Session): Promise<SubscriptionWithPlan> {
  if (!subscription)
    throw new Error('session did not contain subscription data');
  if (typeof subscription === 'string')
    return (await stripe.subscriptions.retrieve(subscription, {
      expand: ['default_payment_method', 'plan.product'],
    })) as any as SubscriptionWithPlan;
  else if (!(subscription as any)?.plan?.product?.name)
    return (await stripe.subscriptions.retrieve(subscription.id, {
      expand: ['default_payment_method', 'plan.product'],
    })) as any as SubscriptionWithPlan;
  return subscription as any as SubscriptionWithPlan;
}

async function getPaymentMethodFromSubscription({
  default_payment_method: paymentMethod,
}: Stripe.Subscription): Promise<Stripe.PaymentMethod> {
  if (!paymentMethod)
    throw new Error('payment method was not found in subscription object');
  if (typeof paymentMethod === 'string')
    return await stripe.paymentMethods.retrieve(paymentMethod, {
      expand: ['billing_details'],
    });
  return paymentMethod;
}

async function addBillingAddress(subscription: Stripe.Subscription) {
  const { client_id: clientId } = subscription.metadata;
  if (!clientId) throw new Error('user id not found in subscription metadata');

  const paymentMethod = await getPaymentMethodFromSubscription(subscription);
  const { address, phone } = paymentMethod.billing_details;

  const query = new Parse.Query(Parse.User);
  const user = await query.get(clientId, { useMasterKey: true });

  if (!user) throw new Error(`user not found in database with id ${clientId}`);

  user.set('billingAddress', address ?? undefined);
  phone && user.set('phone', phone);
  await user.save({ useMasterKey: true });
}

export async function createSubscription(
  clientId: string,
  subscription: SubscriptionWithPlan
) {
  const userQuery = new Parse.Query(Parse.User);
  const [user, dbSubscription] = await Promise.all([
    userQuery.get(clientId, { useMasterKey: true }),
    getOrNewStripeObj('Subscription', subscription.id),
  ]);

  if (!user) throw new Error(`user not found in database with id ${clientId}`);

  dbSubscription.set('stripeId', subscription.id);
  dbSubscription.set('user', user);
  dbSubscription.set('status', subscription.status);
  dbSubscription.set('plan', subscription.plan.product.name);
  dbSubscription.set('interval', subscription.plan.interval);
  dbSubscription.set('cancelAtPeriodEnd', subscription.cancel_at_period_end);
  dbSubscription.set('created', getDate(subscription.created));
  dbSubscription.set(
    'currentPeriodStart',
    getDate(subscription.current_period_start)
  );
  dbSubscription.set(
    'currentPeriodEnd',
    getDate(subscription.current_period_end)
  );
  dbSubscription.set('endedAt', getDate(subscription.ended_at));
  dbSubscription.set('cancelAt', getDate(subscription.cancel_at));
  dbSubscription.set('canceledAt', getDate(subscription.canceled_at));
  await dbSubscription.save({ useMasterKey: true });
}
