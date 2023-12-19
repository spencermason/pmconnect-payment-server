import { Request } from 'express';
import Parse from 'parse/node';
import ExpressError from './error';

const URL = process.env.API_URL;
if (!URL) throw new Error('Missing API_URL environment variable');

Parse.serverURL = URL; // This is your Server URL
// Remember to inform BOTH the Back4App Application ID AND the JavaScript KEY
Parse.initialize(
  'zZGgs8haFNqzgyxYcITqpg2LNaGfW9urx0kiCePj',
  'TQKe7DN6KUAFFCzlJQPZs3ZpO6b36B9ZlKS73OeB',
  'wsypaZ78jIYXPuaydakBAYGvne7CJnzWMcLqsNYG'
);

const headers = {
  'X-Parse-Master-Key': process.env.X_PARSE_MASTER_KEY,
  'X-Parse-Application-Id': process.env.X_PARSE_APPLICATION_ID,
  'X-Parse-REST-API-Key': process.env.X_PARSE_REST_API_KEY,
};

const userEndpoint = `${URL}/users/me`;
export async function getUserData(req: Request, query?: string): Promise<any> {
  const sessionToken = req.headers['x-parse-session-token'];
  if (!(typeof sessionToken === 'string'))
    throw new ExpressError('Request did not provide parse session token', 401);
  const res = await fetch(query ? userEndpoint + '?' + query : userEndpoint, {
    headers: { ...headers, 'X-Parse-Session-Token': sessionToken },
  });
  if (!res.ok) throw new ExpressError('Failed to fetch user data', 401);
  const user = await res.json();
  return user;
}

export async function getOrNewStripeObj(className: string, stripeId: string) {
  const query = new Parse.Query(className);
  const object = await query
    .equalTo('stripeId', stripeId)
    .first({ useMasterKey: true });
  if (object) return object;

  const newObject = new Parse.Object(className);
  return newObject;
}
