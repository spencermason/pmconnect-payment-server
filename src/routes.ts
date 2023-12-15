import * as Express from 'express';
import { z } from 'zod';
import Parse from 'parse/node';

import {
  isSubscriptionActive,
  manageSubscriptionStatusChange,
  stripe,
} from './stripe';
import webhookHandler from './webhooks';
import { getUserData } from './utils/parse';
import Stripe from 'stripe';

const subscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
});

const routes = Express.Router();

async function getCheckoutUrl(req: Express.Request) {
  const user = await getUserData(req);
  if (!user) throw { status: 401, message: 'user not logged in' };
  if (
    user.subscription &&
    isSubscriptionActive(user.subscription as Stripe.Subscription)
  )
    throw { status: 400, message: 'already subscribed' };

  const metadata = {};
  const redirect = req.query.redirect as string | undefined;
  const stripeSession = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    billing_address_collection: 'required',
    customer_email: user.email,
    line_items: [
      {
        price: process.env.STRIPE_SUBSCRIBE_PRICE_ID,
        quantity: 1,
      },
    ],
    mode: 'subscription',
    subscription_data: {
      metadata: { ...metadata, clientId: user.id },
    },
    success_url: `${process.env.API_URL}/${redirect || ''}`,
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
    res.status(200).json({ sessionUrl });
  } catch (err: any) {
    return res.status(err.status).send(err.message);
  }
});

routes.post(
  '/webhooks',
  Express.raw({ type: 'application/json' }),
  webhookHandler
);

routes.put('/update-subscription', async (req, res) => {
  const data = subscriptionSchema.safeParse(req.body);
  if (!data.success) {
    return res.status(400).json((data as any).error);
  }

  const user = await getUserData(req);
  if (!user.subscription) res.status(400).send('user not subscribed');

  const subscription = await stripe.subscriptions.update(user.subscription.id, {
    cancel_at_period_end: data.data.cancelAtPeriodEnd,
  });
  manageSubscriptionStatusChange(subscription);

  res.status(200).json({ subscription });
});

export default routes;
