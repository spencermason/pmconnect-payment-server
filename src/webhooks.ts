import { Request, RequestHandler } from 'express';
import Stripe from 'stripe';
import { getOrNew, manageSubscriptionStatusChange, stripe } from './stripe';

const stripeWebhookSecret = '';

async function getStripeEvent(req: Request): Promise<Stripe.Event> {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = stripeWebhookSecret;
  if (!sig) throw new Error('request missing stripe-signature');
  if (!webhookSecret) throw new Error('missing webhook secret');

  return stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
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

    if (!relevantEvents.has(event.type)) return res.json({ received: true });

    await handleEvent(event);
    res.json({ received: true });
  } catch (error: any) {
    console.error(`❌ Error message: ${error.message}`);
    return res.status(400).json(`Webhook Error: ${error.message}`);
  }
};
export default webhookHandler;

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'product.created':
    case 'product.updated':
      await upsertProduct(event.data.object as Stripe.Product);
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
      await upsertPrice(event.data.object as Stripe.Price);
      break;
    case 'price.deleted':
      const priceQuery = new Parse.Query('Price');
      try {
        // here you put the objectId that you want to delete
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
      const subscription = event.data.object as Stripe.Subscription;
      await Promise.all([
        manageSubscriptionStatusChange(subscription),
        event.type === 'customer.subscription.updated' &&
          addBillingAddress(subscription),
      ]);
      break;
    }
    case 'checkout.session.completed': {
      const checkoutSession = event.data.object as Stripe.Checkout.Session;
      if (checkoutSession.mode !== 'subscription') break;

      const subscription = await getSubscriptionFromCheckoutSession(
        checkoutSession
      );
      await Promise.all([
        manageSubscriptionStatusChange(subscription),
        addBillingAddress(subscription),
      ]);
      break;
    }
    default:
      throw new Error('Unhandled relevant event!');
  }
}

function getId(product: string | { id: string } | null) {
  if (!product) throw new Error('Missing id');
  return typeof product == 'string' ? product : product.id;
}

const Product = Parse.Object.extend('Product');
async function upsertProduct(data: Stripe.Product) {
  const product = await getOrNew('Product', getId(data));
  product.set('active', data.active);
  product.set('name', data.name);
  product.set('metadata', data.metadata);
  await product.save();
}

const Price = Parse.Object.extend('Price');
async function upsertPrice(data: Stripe.Price) {
  const price = await getOrNew('Price', getId(data));
  price.set('active', data.active);
  price.set('unitAmount', data.unit_amount);
  price.set('currency', data.currency);
  price.set('type', data.type);
  price.set('metadata', data.metadata);
  price.set('interval', data.recurring?.interval);
  price.set('intervalCount', data.recurring?.interval_count);
  await price.save();
}

async function getSubscriptionFromCheckoutSession({
  subscription,
}: Stripe.Checkout.Session): Promise<Stripe.Subscription> {
  if (!subscription)
    throw new Error('session did not contain subscription data');
  if (typeof subscription === 'string')
    return await stripe.subscriptions.retrieve(subscription, {
      expand: ['default_payment_method'],
    });
  return subscription;
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
  const { clientId } = subscription.metadata;
  if (!clientId) throw new Error('user id not found in subscription metadata');

  const paymentMethod = await getPaymentMethodFromSubscription(subscription);
  const { address, phone, name } = paymentMethod.billing_details;

  const user = await getOrNew('User', clientId);
  user.set('address', address ?? undefined);
  user.set('phone', phone ?? undefined);
  user.set('name', name ?? undefined);
}
