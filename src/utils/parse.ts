import { Request } from 'express';
import _Parse from 'parse/node';

const URL = process.env.API_URL;
if (!URL) throw new Error('Missing API_URL environment variable');

_Parse.serverURL = URL; // This is your Server URL
// Remember to inform BOTH the Back4App Application ID AND the JavaScript KEY
_Parse.initialize(
  'zZGgs8haFNqzgyxYcITqpg2LNaGfW9urx0kiCePj',
  'TQKe7DN6KUAFFCzlJQPZs3ZpO6b36B9ZlKS73OeB',
  'wsypaZ78jIYXPuaydakBAYGvne7CJnzWMcLqsNYG'
);

const graphQLUrl = `${URL}/qraphql`;

const headers = {
  'X-Parse-Master-Key': process.env.X_PARSE_MASTER_KEY,
  'X-Parse-Application-Id': process.env.X_PARSE_APPLICATION_ID,
  'X-Parse-REST-API-Key': process.env.X_PARSE_REST_API_KEY,
};

function removeUndefined(obj: any) {
  if (typeof obj !== 'object') return;
  for (const _key in obj) {
    const key = _key as keyof typeof obj;
    const val = obj[key];
    if (val === undefined) delete obj[key];
    if (typeof val === 'object') removeUndefined(obj);
  }
  return obj;
}

const userEndpoint = `${URL}/users/me`;
export async function getUserData(req: Request): Promise<any> {
  const sessionToken = req.headers['X-Parse-Session-Token'];
  if (!(typeof sessionToken === 'string')) throw new Error();
  const query = await fetch(userEndpoint, {
    headers: { ...headers, 'X-Parse-Session-Token': sessionToken },
  });
  if (!query.ok) throw new Error();
  const user = await query.json();
  return user;
}

// export async function setObjData(className: string, id: string, set: any) {
//   removeUndefined(set);
//   let fieldString = '';
//   for (const field in set) {
//     if (fieldString !== '') fieldString += ',\n';
//     fieldString += `${field}: "${set[field]}"`;
//   }
//   const queryStr = `mutation UpdateObject {
//     update(className: "${className}", objectId: "${id}", fields: { ${fieldString} }) {
//       updatedAt
//     }
//   }`;
//   const query = await fetch(graphQLUrl, { body: queryStr, headers });
//   if (!query.ok) throw new Error();
//   return await query.json();
// }

// export async function deleteObj(className: string, id: string) {
//   const queryStr = `mutation UpdateObject {
//     update(className: "${className}", objectId: "${id}" }) {
//       updatedAt
//     }
//   }`;
//   const query = await fetch(graphQLUrl, { body: queryStr, headers });
//   if (!query.ok) throw new Error();
//   return await query.json();
// }
