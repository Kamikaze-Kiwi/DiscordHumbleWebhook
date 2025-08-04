import puppeteer from 'puppeteer';
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

console.log("Connecting to database...");

const sql = postgres(process.env.DATABASE_CONNECTION_STRING);
const alreadyPushed = (await sql`SELECT * FROM PushedBundles`).map(row => row.bundle);
const webhooks = await sql`SELECT * FROM Webhooks`;

console.log(`Retrieved ${alreadyPushed.length} pushed bundles and ${webhooks.length} webhooks`);

console.log("Starting puppeteer...");

puppeteer.launch().then(async browser => {
    const page = await browser.newPage();

    console.log("Opening Humble Bundle Website...");

    await page.goto('https://www.humblebundle.com/games');
    await page.waitForSelector(".js-games-mosaic");

    console.log("Scraping bundles...");

    const bundles = await page.evaluate(() => {
        return [...document.querySelectorAll(".js-games-mosaic a.full-tile-view")].map((bundle) => {
            return {
                href: bundle.href.split('?')[0],
                name: bundle.querySelector(".name").innerHTML
            }
        });
    });

    for (let i = 0; i < alreadyPushed.length; i++) {
        if (!bundles.some(bundle => bundle.href === alreadyPushed[i])) {
            await sql`DELETE FROM PushedBundles WHERE bundle = ${alreadyPushed[i]}`;
            console.log(`Bundle ${alreadyPushed[i]} was removed from the pushed bundles list as this bundle expired.`);
        }
    }


    for (let i = 0; i < bundles.length; i++) {

        console.log(`Checking bundle ${i + 1} / ${bundles.length}...`);

        if (alreadyPushed.includes(bundles[i].href)) continue;

        await page.goto(bundles[i].href);
        await page.waitForSelector(".basic-info-view .heading-medium");

        console.log(`Scraping bundle ${i + 1} (${bundles[i].name})...`);

        const bundle = await page.evaluate((bundle) => {
            return {
                name: bundle.name,
                href: bundle.href,
                image: document.querySelector(".bundle-logo").src,
                price: document.querySelector(".tier-header").innerText.match(new RegExp(`[${document.querySelector('.currency-symbol').innerText}][0-9.]+`))[0],
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
                        text: bundle.href
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

        console.log(`Pushing bundle ${i + 1} (${bundles[i].name}) to ${webhooks.length} webhooks...`);

        for (let i = 0; i < webhooks.length; i++) {
            if (webhooks[i].Ping) {
                if (webhooks[i].Ping === "everyone" || webhooks[i].Ping === "here") {
                    discordEmbed.content = `@${webhooks[i].Ping}`;
                } else {
                    discordEmbed.content = `<@&${webhooks[i].Ping}>`;
                }
            } else {
                discordEmbed.content = "";
            }

            await fetch(webhooks[i].Url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(discordEmbed)
            });
        }

        await sql`INSERT INTO PushedBundles (bundle) VALUES (${bundle.href})`;
    };

    console.log("Closing puppeteer and database...");

    await browser.close();
    await sql.end();

    console.log("All done!");
});
