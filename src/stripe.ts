import Stripe from 'stripe';

export const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY);

export function getDate(timeStamp: number): Date;
export function getDate(timeStamp: number | null | undefined): Date | undefined;
export function getDate(timeStamp: number | null | undefined) {
  if (typeof timeStamp === 'number') return new Date(timeStamp * 1000);
  else return undefined;
}

export function isSubscriptionActive(subscription: Stripe.Subscription) {
  return (
    subscription.status === 'active' ||
    subscription.status === 'trialing' ||
    subscription.status === 'incomplete'
  );
}
