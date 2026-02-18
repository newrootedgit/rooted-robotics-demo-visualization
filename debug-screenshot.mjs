#!/usr/bin/env node
// Automated screenshot debugger for MuJoCo demo
// Takes screenshots from multiple camera angles for IK debugging

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';

const SCREENSHOTS_DIR = './debug-screenshots';
const PORT = 5173;

async function startServer() {
    return new Promise((resolve, reject) => {
        const server = spawn('npx', ['vite', 'preview', '--port', PORT.toString()], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        server.stdout.on('data', (data) => {
            if (data.toString().includes('Local:')) {
                resolve(server);
            }
        });
        
        server.stderr.on('data', (data) => {
            console.error('Server error:', data.toString());
        });
        
        setTimeout(() => resolve(server), 3000); // Fallback
    });
}

async function takeScreenshots() {
    console.log('Starting debug screenshot session...');
    
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    
    console.log('Starting preview server...');
    const server = await startServer();
    
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    
    const url = `http://localhost:${PORT}`;
    console.log(`Loading ${url}...`);
    await page.goto(url);
    
    // Wait for scene to load
    await page.waitForTimeout(2000);
    
    // Pause the simulation
    await page.click('#playPause');
    await page.waitForTimeout(500);
    
    // Camera presets to capture
    const cameras = ['iso', 'top', 'front', 'side'];
    
    for (const cam of cameras) {
        console.log(`Capturing ${cam} view...`);
        await page.click(`[data-cam="${cam}"]`);
        await page.waitForTimeout(300);
        await page.screenshot({ 
            path: `${SCREENSHOTS_DIR}/${cam}.png`,
            fullPage: false 
        });
    }
    
    // Also get stats text
    const stats = await page.textContent('#stats');
    console.log('Stats:', stats);
    
    // Get arm info from console
    const armInfo = await page.evaluate(() => {
        if (typeof robotArms !== 'undefined') {
            return robotArms.map((a, i) => ({
                idx: i,
                state: a.state,
                mount: { x: a.config.x, z: a.config.z },
                target: { x: a.targetPos.x, y: a.targetPos.y, z: a.targetPos.z }
            }));
        }
        return 'robotArms not accessible';
    });
    console.log('Arm info:', JSON.stringify(armInfo, null, 2));
    
    await browser.close();
    server.kill();
    
    console.log(`\nScreenshots saved to ${SCREENSHOTS_DIR}/`);
    console.log('Files: iso.png, top.png, front.png, side.png');
}

takeScreenshots().catch(console.error);
