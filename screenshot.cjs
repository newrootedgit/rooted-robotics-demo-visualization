const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = './debug-screenshots';
const URL = 'http://localhost:5174';

async function main() {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    
    console.log(`Loading ${URL}...`);
    await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
    
    // Wait for Three.js to render
    await page.waitForTimeout(3000);
    
    // Pause simulation
    await page.click('#playPause').catch(() => console.log('Could not click pause'));
    await page.waitForTimeout(500);
    
    // Take screenshots from each camera angle
    const cameras = ['iso', 'top', 'front', 'side'];
    
    for (const cam of cameras) {
        console.log(`Capturing ${cam} view...`);
        await page.click(`[data-cam="${cam}"]`).catch(() => console.log(`No ${cam} button`));
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${cam}.png`) });
    }
    
    // Get stats
    const stats = await page.$eval('#stats', el => el.textContent).catch(() => 'N/A');
    console.log('Stats:', stats);
    
    await browser.close();
    console.log(`\nScreenshots saved to ${SCREENSHOTS_DIR}/`);
}

main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
