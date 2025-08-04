import type { VercelRequest, VercelResponse } from '@vercel/node'
import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { webhook }: { webhook: string } = req.body

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

    let result;
    try {
        result = await connection.query('DELETE FROM Webhooks WHERE (URL=?)', [webhook]);
    } catch (error) {
        return res.status(500).json({
            message: `Internal Server Error while inserting to database`,
        })
    }
    finally {
        await connection.end();

        if (result[0].affectedRows === 0) {
            return res.status(404).json({
                message: `webhook with url [${webhook}] does not exist`,
            })
        }

        return res.json({
            message: `Webhook successfully deleted`,
        })
    }
}