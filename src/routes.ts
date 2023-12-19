import * as Express from 'express';
import Parse from 'parse/node';
import { z } from 'zod';

import { isSubscriptionActive, stripe } from './stripe';
import { getUserData } from './utils/parse';
import webhookHandler from './webhooks';
import ExpressError from './utils/error';

const routes = Express.Router();

const checkoutSchema = z.object({
  priceId: z.string(),
});

function getPriceId(req: Express.Request): string {
  if (req.method === 'GET') {
    return process.env.STRIPE_DEFAULT_SUBSCRIBE_PRICE_ID;
  }

  const body = checkoutSchema.safeParse(req.body);
  if (!body.success) {
    throw new ExpressError((body as any).error, 400);
  }
  return body.data.priceId;
}

async function getCheckoutUrl(req: Express.Request) {
  const priceId = getPriceId(req);
  const user = await getUserData(req);
  if (!user) throw new ExpressError('user not logged in', 401);

  const redirect = req.query.redirect as string | undefined;
  const stripeSession = await stripe.checkout.sessions.create({
    client_reference_id: user.objectId,
    payment_method_types: ['card'],
    billing_address_collection: 'required',
    customer_email: user.email,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    success_url: `${process.env.CALLBACK_URL}/${redirect || ''}`,
    cancel_url: `${process.env.CALLBACK_URL}/`,
  });

  const sessionUrl = stripeSession.url;
  if (!sessionUrl) throw new ExpressError('stripe session url not found', 500);
  return sessionUrl;
}
routes.get('/create-checkout-session', async (req, res) => {
  try {
    const sessionUrl = await getCheckoutUrl(req);
    res.redirect(sessionUrl);
  } catch (err: any) {
    return res.status(err.status).send(err.message);
  }
});
routes.post('/create-checkout-session', async (req, res) => {
  try {
    const sessionUrl = await getCheckoutUrl(req);
    res.status(200).json({ url: sessionUrl });
  } catch (err: any) {
    console.error(err);
    return res.status(err.status || 500).send(err.message);
  }
});

routes.post(
  '/webhooks',
  Express.raw({ type: 'application/json' }),
  webhookHandler
);

const subscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
});
routes.post('/create-portal-session', async (req, res) => {
  try {
    const user = await getUserData(req);
    if (!user) throw new ExpressError('user not logged in', 401);

    const query = new Parse.Query('Subscription');
    query.equalTo('user', Parse.User.createWithoutData(user.objectId));
    const subscription = await query.first();

    if (!subscription || !isSubscriptionActive(subscription.get('status')))
      return res.status(401).send('user not subscribed');

    const redirect = req.query.redirect as string | undefined;
    const stripeCustomerId = subscription.get('stripeCustomerId');
    if (!stripeCustomerId) throw new ExpressError('stripeCustomerId not found');

    const stripePortalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${process.env.CALLBACK_URL}/${redirect || ''}`,
    });

    const { url } = stripePortalSession;
    if (!url) throw new ExpressError('stripe session url not found');
    res.status(200).json({ url });
  } catch (err: any) {
    console.error(err);
    return res.status(err.status || 500).send(err.message);
  }
});

routes.put('/update-subscription', async (req, res) => {
  const data = subscriptionSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json((data as any).error);
  }

  const user = await getUserData(req);
  if (!user.subscription) res.status(400).send('user not subscribed');

  // TODO add more updating options
  const subscription = await stripe.subscriptions.update(user.subscription.id, {
    cancel_at_period_end: data.data.cancelAtPeriodEnd,
  });

  res.status(200).json({ subscription });
});

export default routes;
