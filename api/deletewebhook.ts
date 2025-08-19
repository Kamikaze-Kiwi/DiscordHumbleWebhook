import type { VercelRequest, VercelResponse } from '@vercel/node'
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { webhook }: { webhook: string } = req.body

    if (!webhook || webhook === '') {
        return res.status(400).json({
            message: `webhook is required`,
        })
    }

    if (webhook.indexOf('discord.com/api/webhooks') === -1) {
        return res.status(400).json({
            message: `Webhook URL is invalid. Please follow the instructions to obtain the webhook URL.`,
        })
    }

    const connectionString = process.env.DATABASE_CONNECTION_STRING;
    if (!connectionString) {
        return res.status(500).json({ message: `Internal Server Error while connecting to database` });
    }
    const sql = postgres(connectionString);

    let result;
    try {
        result = await sql`DELETE FROM webhooks WHERE url = ${webhook}`;
    } catch (error) {
        return res.status(500).json({
            message: `Internal Server Error while deleting from database. ${error.message}`,
        })
    }
    finally {
        await sql.end();
    }

    if (result.count === 0) {
        return res.status(404).json({
            message: `webhook with url [${webhook}] does not exist`,
        })
    }

    return res.json({
        message: `Webhook successfully deleted`,
    })
}