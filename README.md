# purplelok-crm

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-tnmphwtb)

## Frontend environment

Copy `.env.example` to the ignored `.env.local` file for local development and
set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` to the URL and browser-safe
publishable/anon key from the same Supabase project. Configure those same names
in the production host before running `npm run build`. Never place a
`service_role` or secret key in a `VITE_` variable because Vite embeds these
values in browser assets.

Node 22 LTS is the repository default (`.nvmrc`); supported Node releases are
declared in `package.json`.
