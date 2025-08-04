import type { VercelRequest, VercelResponse } from '@vercel/node'
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { webhook, currency = "$", ping = null }: { webhook: string, currency: string, ping: string | null } = req.body

  if (!webhook || webhook === '') {
    return res.status(400).json({
      message: `webhook is required`,
    })
  }

  if (!webhook.startsWith('https://discord.com/api/webhooks/')) {
    return res.status(400).json({
      message: `Webhook is invalid. Please ensure it starts with https://discord.com/api/webhooks/`,
    })
  }

  const connectionString = process.env.DATABASE_CONNECTION_STRING;
  if (!connectionString) {
    return res.status(500).json({ message: `Internal Server Error while connecting to database` });
  }
  const sql = postgres(connectionString);

  try {
    const result = await sql`INSERT INTO webhooks (url, currency, ping) VALUES (${webhook}, ${currency}, ${ping})`;

      // Send a welcome message to the new webhook to confirm it's working
      await fetch(webhook, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "content": "This channel has now been set up to be notified of any new Humble Bundle as soon as they come out. To modify or delete this integration, please visit https://humble-webhook-registrator.vercel.app/. \n\nThis service is not affiliated with Humble Bundle. If you experience any issues, they can be reported at https://github.com/Kamikaze-Kiwi/DiscordHumbleWebhook/issues/new.",
          "tts": false,
          "components": [],
          "actions": {},
          "username": "Humble Bundle",
          "avatar_url": "https://cdn.freebiesupply.com/logos/large/2x/humblebundle-logo-png-transparent.png"
        })
      });

  } catch (error) {
    if (error.code === '23505') { // PostgreSQL unique violation error code
      return res.status(409).json({
        message: `webhook with url [${webhook}] already exists`,
      })
    }

    return res.status(500).json({
      message: `Internal Server Error while inserting to database. ${error.message}`,
    })
  }
  finally {
    await sql.end();
  }

  return res.json({
    message: `Webhook successfully added`,
  })
}