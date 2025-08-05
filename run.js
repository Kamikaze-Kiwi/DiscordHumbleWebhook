import puppeteer from 'puppeteer';
import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

console.log("Connecting to database...");

const sql = postgres(process.env.DATABASE_CONNECTION_STRING);
const alreadyPushed = (await sql`SELECT * FROM pushedbundles`).map(row => row.bundle);
const webhooks = await sql`SELECT * FROM webhooks`;

console.log(`Retrieved ${alreadyPushed.length} pushed bundles and ${webhooks.length} webhooks`);

console.log("Starting puppeteer...");

puppeteer.launch().then(async browser => {
    const page = await browser.newPage();

    console.log("Opening Humble Bundle Website...");

    await page.goto('https://www.humblebundle.com/bundles');
    await page.waitForSelector(".js-games-mosaic");

    console.log("Scraping bundles...");

    const bundles = await page.evaluate(() => {
        return [...document.querySelectorAll("a.full-tile-view")].map((bundle) => {
            return {
                href: bundle.href.split('?')[0],
                name: bundle.querySelector(".name").innerHTML,
                category: bundle.pathname.split('/')[1]
            }
        });
    });

    for (let i = 0; i < alreadyPushed.length; i++) {
        if (!bundles.some(bundle => bundle.href === alreadyPushed[i])) {
            await sql`DELETE FROM pushedbundles WHERE bundle = ${alreadyPushed[i]}`;
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
                category: bundle.category,
                image: document.querySelector(".bundle-logo").src,
                price: document.querySelector(".tier-header").innerText.match(new RegExp(`[${document.querySelector('.currency-symbol').innerText}][0-9.]+`))[0],
                offerEnd: {
                    days: parseInt(document.querySelector(".js-days")?.innerText || 0),
                    hours: parseInt(document.querySelector(".js-hours")?.innerText || 0),
                    minutes: parseInt(document.querySelector(".js-minutes")?.innerText || 0)
                },
                items: [
                    [...document.querySelectorAll(".item-details .item-title")].map((item) => item.innerText)
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
                    description: `**Price**: ${bundle.price}\n\n
                    **${bundle.category.charAt(0).toUpperCase() + bundle.category.slice(1)}**\n
                    ${bundle.items.flat().slice(0, 20).join("\n")}${bundle.items.flat().length > 20 ? `\n... and ${bundle.items.flat().length - 20} others!` : ""}`,
                }
            ],
            components: [],
            actions: {},
            username: "Humble Bundle",
            avatar_url: "https://cdn.freebiesupply.com/logos/large/2x/humblebundle-logo-png-transparent.png"
        };

        console.log(`Pushing bundle ${i + 1} (${bundles[i].name}) to ${webhooks.length} webhooks...`);

        for (let i = 0; i < webhooks.length; i++) {
            if (!webhooks[i].categories.includes(bundle.category)) {
                continue;
            }

            if (webhooks[i].ping && webhooks[i].ping !== "none") {
                if (webhooks[i].ping === "everyone" || webhooks[i].ping === "here") {
                    discordEmbed.content = `@${webhooks[i].ping}`;
                } else {
                    discordEmbed.content = `<@&${webhooks[i].ping}>`;
                }
            } else {
                discordEmbed.content = "";
            }

            try {
                await fetch(webhooks[i].url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(discordEmbed)
                });
            } catch (error) {
                console.error(`Error sending webhook to ${webhooks[i].url}:`, error);
            }
        }
        await sql`INSERT INTO pushedbundles (bundle, category) VALUES (${bundle.href}, ${bundle.category})`;
    };

    console.log("Closing puppeteer and database...");

    await browser.close();
    await sql.end();

    console.log("All done!");
});
