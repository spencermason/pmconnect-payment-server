import * as Express from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';

import { isSubscriptionActive, stripe } from './stripe';
import { getUserData } from './utils/parse';
import webhookHandler from './webhooks';

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
    throw { status: 400, message: (body as any).error };
  }
  return body.data.priceId;
}

async function getCheckoutUrl(req: Express.Request) {
  const priceId = getPriceId(req);
  const user = await getUserData(req);
  if (!user) throw { status: 401, message: 'user not logged in' };
  if (
    user.subscription &&
    isSubscriptionActive(user.subscription as Stripe.Subscription)
  )
    throw { status: 400, message: 'already subscribed' };

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
    subscription_data: {
      metadata: { client_id: user.objectId },
    },
    success_url: `${process.env.CALLBACK_URL}/${redirect || ''}`,
    cancel_url: `${process.env.CALLBACK_URL}/`,
  });

  const sessionUrl = stripeSession.url;
  if (!sessionUrl)
    throw { status: 500, message: 'stripe session url not found' };
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
