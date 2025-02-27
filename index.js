import puppeteer from 'puppeteer';
import mysql2 from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

module.exports = async ({ connectionString = null }) => {
    const sql = await mysql2.createConnection(connectionString || process.env.DATABASE_CONNECTION_STRING);
    const alreadyPushed = (await sql.query("SELECT * FROM PushedBundles"))[0].map(row => row.Bundle);
    const webhooks = (await sql.query("SELECT * FROM Webhooks"))[0];

    puppeteer.launch().then(async browser => {
        const page = await browser.newPage();
        await page.goto('https://www.humblebundle.com/games');

        const bundles = await page.evaluate(() => {
            return [...document.querySelectorAll(".js-games-mosaic a.full-tile-view")].map((bundle) => {
                return {
                    href: bundle.href.split('?')[0],
                    name: bundle.querySelector(".name").innerHTML
                }
            });
        });

        for (let i = 0; i < bundles.length; i++) {
            if (alreadyPushed.includes(bundles[i].href)) continue;

            await page.goto(bundles[i].href);
            await page.waitForSelector(".basic-info-view .heading-medium");

            const bundle = await page.evaluate((bundle) => {
                return {
                    name: bundle.name,
                    href: bundle.href,
                    image: document.querySelector(".bundle-logo").src,
                    price: document.querySelector(".tier-header").innerText.match(/€[0-9.]+/)[0],
                    offerEnd: {
                        days: parseInt(document.querySelector(".js-days").innerText),
                        hours: parseInt(document.querySelector(".js-hours").innerText),
                        minutes: parseInt(document.querySelector(".js-minutes").innerText)
                    },
                    games: [
                        [...document.querySelectorAll(".item-details .item-title")].map((game) => game.innerText)
                    ]
                };
            }, bundles[i]);

            let offerExpire = new Date();
            offerExpire.setDate(offerExpire.getDate() + bundle.offerEnd.days);
            offerExpire.setHours(offerExpire.getHours() + bundle.offerEnd.hours);
            offerExpire.setMinutes(offerExpire.getMinutes() + bundle.offerEnd.minutes);

            const discordEmbed = {
                content: "",
                tts: false,
                embeds: [
                    {
                        description: `Offer expires <t:${Math.floor(offerExpire.valueOf() / 1000)}:R>, on <t:${Math.floor(offerExpire.valueOf() / 1000)}:F>`,
                        title: bundle.name,
                        image: {
                            url: bundle.image
                        },
                        footer: {
                            text: "https://www.humblebundle.com/games/better-with-friend-coop-adventures"
                        },
                        url: bundle.href,
                    },
                    {
                        description: `**Price**: ${bundle.price}\n\n**Games**\n ${bundle.games.flat().join("\n")}`,
                    }
                ],
                components: [],
                actions: {},
                username: "Humble Bundle",
                avatar_url: "https://cdn.freebiesupply.com/logos/large/2x/humblebundle-logo-png-transparent.png"
            };

            for (let i = 0; i < webhooks.length; i++) {
                await fetch(webhooks[i].Url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(discordEmbed)
                });
            }

            await sql.query("INSERT INTO PushedBundles (bundle) VALUES (?)", [bundle.href]);
        };

        await browser.close();
        await sql.end();
    });
};

