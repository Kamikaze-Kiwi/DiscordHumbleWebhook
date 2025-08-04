import type { VercelRequest, VercelResponse } from '@vercel/node'
import mysql2 from 'mysql2/promise';
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
  const connection = await mysql2.createConnection(connectionString);

  try {
    const result = await connection.query('INSERT INTO Webhooks (Url, Currency, Ping) VALUES (?, ?, ?)', [webhook, currency, ping]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        message: `webhook with url [${webhook}] already exists`,
      })
    }

    return res.status(500).json({
      message: `Internal Server Error while inserting to database`,
    })
  }
  finally {
    await connection.end();
  }

  return res.json({
    message: `Webhook successfully added`,
  })
}