import Parse from 'parse/node';
import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY);

const Subscription = Parse.Object.extend('Subscription');

export function getDate(timeStamp: number): Date;
export function getDate(timeStamp: number | null | undefined): Date | undefined;
export function getDate(timeStamp: number | null | undefined) {
  if (typeof timeStamp === 'number') return new Date(timeStamp * 1000);
  else return undefined;
}
export async function manageSubscriptionStatusChange(
  subscription: Stripe.Subscription
) {
  const { clientId } = subscription.metadata;
  if (!clientId) throw new Error('user id not found in subscription metadata');

  const newSubscription = await getOrNew('Subscription', subscription.id);
  const user = await getOrNew('User', clientId);

  newSubscription.set('user', user);
  newSubscription.set('status', subscription.status);
  newSubscription.set('metadata', subscription.metadata);
  newSubscription.set('cancelAtPeriodEnd', subscription.cancel_at_period_end);
  newSubscription.set('created', getDate(subscription.created));
  newSubscription.set(
    'currentPeriodStart',
    getDate(subscription.current_period_start)
  );
  newSubscription.set(
    'currentPeriodEnd',
    getDate(subscription.current_period_end)
  );
  newSubscription.set('endedAt', getDate(subscription.ended_at));
  newSubscription.set('cancelAt', getDate(subscription.cancel_at));
  newSubscription.set('canceledAt', getDate(subscription.canceled_at));
  await newSubscription.save();
}

export function isSubscriptionActive(subscription: Stripe.Subscription) {
  return (
    subscription.status === 'active' ||
    subscription.status === 'trialing' ||
    subscription.status === 'incomplete'
  );
}

export async function getOrNew(className: string, id: string) {
  const obj = new Parse.Query(className);
  try {
    const object = await obj.get(id);
    return object;
  } catch {
    const object = new Parse.Object(className);
    object.id = id;
    return object;
  }
}
