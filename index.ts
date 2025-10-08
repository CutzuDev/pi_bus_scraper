import { Builder, Browser, By, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions, ServiceBuilder } from 'selenium-webdriver/chrome';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// --- CONFIGURATION & TYPES ---

const ROUTES_FILE = join(import.meta.dir, 'routes.json');
const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "/usr/bin/chromedriver";

interface Route {
    id: string;
    routeNumber: string; // e.g., "23b"
    direction: 'dus' | 'intors'; // dus or intors
    stationName: string;
    stationSlug: string; // e.g., "sala-sporturilor" or "4"
    url: string; // Full URL from scraper (e.g., "https://www.ratbv.ro/afisaje/23b-intors/line_23b_4_cl1_ro.html")
    directionFrom?: string;
    directionTo?: string;
    cachedBusTimes?: string[];
    cacheTimestamp?: number;
}

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

// --- DATA HANDLING ---

async function loadRoutes(): Promise<Route[]> {
    try {
        const data = await readFile(ROUTES_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveRoutes(routes: Route[]): Promise<void> {
    await writeFile(ROUTES_FILE, JSON.stringify(routes, null, 2));
}

// --- WEB SCRAPER (IMPROVED EFFICIENCY) ---

interface StationData {
    route: string;
    name: string;
    link: string;
}

interface LineMetadata {
    lineName: string;
    stations: StationData[];
}

async function scrapeLineMetadata(masterUrl: string): Promise<LineMetadata> {
    const chromeOptions = new ChromeOptions();
    chromeOptions.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage');
    const service = new ServiceBuilder(CHROMEDRIVER_PATH);

    const driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(chromeOptions)
        .setChromeService(service)
        .build();

    try {
        await driver.get(masterUrl);

        // Get line name from frame 2 (MainFrame)
        await driver.switchTo().frame(2);
        const linie = await driver.findElement(By.id("linia_web")).findElement(By.tagName("b")).getText();

        // Switch back to main content then to frame 1 for station list
        await driver.switchTo().defaultContent();
        await driver.switchTo().frame(1);

        // Get all station elements (both list_sus_active and list_statie)
        const stationElements = await driver.findElements(By.css('.list_sus_active, .list_statie, .list_jos'));

        const stations: StationData[] = [];

        // Loop through each station and extract the name and link
        for (const station of stationElements) {
            const boldElement = await station.findElement(By.tagName('b'));
            const stationName = await boldElement.getText();

            // Get the <a> tag and extract the href
            const linkElement = await station.findElement(By.tagName('a'));
            const href = await linkElement.getAttribute('href');

            const stationLinkName = stationName.toLowerCase().replace(/\./g, '').replace(/\s+/g, '-');
            const stationData = { route: stationLinkName, name: stationName, link: href };

            stations.push(stationData);
        }

        return { lineName: linie, stations };
    } finally {
        await driver.quit();
    }
}

async function scrapeBusTimes(url: string): Promise<string[]> {
    const options = new ChromeOptions();
    options.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage');

    const service = new ServiceBuilder(CHROMEDRIVER_PATH);
    let driver: WebDriver | null = null;

    try {
        driver = await new Builder()
            .forBrowser(Browser.CHROME)
            .setChromeOptions(options)
            .setChromeService(service)
            .build();

        await driver.get(url);

        const table = await driver.findElement(By.id('tabel2'));
        const hoursElements = await table.findElements(By.css('#web_class_hours'));
        const minutesWrapperElements = await table.findElements(By.css('#web_class_minutes'));

        // Get all texts in parallel for speed
        const hourTexts = await Promise.all(hoursElements.map(el => el.getText()));
        const minuteTextsByHour = await Promise.all(minutesWrapperElements.map(async (wrapper) => {
            const minuteElements = await wrapper.findElements(By.css('#web_min'));
            return Promise.all(minuteElements.map(el => el.getText()));
        }));

        // Combine the results
        const busTimes: string[] = [];
        hourTexts.forEach((hour, i) => {
            if (minuteTextsByHour[i]) {
                minuteTextsByHour[i].forEach(minute => {
                    busTimes.push(`${hour.trim()}:${minute.trim()}`);
                });
            }
        });

        return busTimes;
    } finally {
        await driver?.quit();
    }
}

// --- SERVER & ROUTING ---

const server = Bun.serve({
    port: 4200,
    async fetch(req) {
        const url = new URL(req.url);
        const method = req.method;

        // --- API ROUTES ---
        if (url.pathname === '/api/routes' && method === 'GET') {
            const routes = await loadRoutes();
            return new Response(JSON.stringify(routes), { headers: { 'Content-Type': 'application/json' } });
        }

        if (url.pathname === '/api/routes' && method === 'POST') {
            try {
                const newRoute: Route = await req.json();
                console.log('🌐 [API] POST /api/routes called');
                console.log('🌐 [API] New route data:', newRoute);

                const routes = await loadRoutes();
                console.log('🌐 [API] Existing routes count:', routes.length);

                if (routes.some(r => r.id === newRoute.id)) {
                    console.error('❌ [API] Route ID already exists:', newRoute.id);
                    return new Response(JSON.stringify({ message: 'ID already exists' }), { status: 400 });
                }

                routes.push(newRoute);
                await saveRoutes(routes);
                console.log('✅ [API] Route saved successfully. Total routes:', routes.length);

                return new Response(JSON.stringify({ success: true }), { status: 201 });
            } catch (error) {
                console.error('❌ [API] Error adding route:', error);
                return new Response(JSON.stringify({ message: 'Invalid request body' }), { status: 400 });
            }
        }

        if (url.pathname.startsWith('/api/routes/') && method === 'DELETE') {
            const id = url.pathname.split('/api/routes/')[1];
            const routes = await loadRoutes();
            const filtered = routes.filter(r => r.id !== id);
            await saveRoutes(filtered);
            return new Response(JSON.stringify({ success: true }));
        }

        if (url.pathname.startsWith('/api/invalidate-cache/') && method === 'POST') {
            const id = url.pathname.split('/api/invalidate-cache/')[1];
            const routes = await loadRoutes();
            const route = routes.find(r => r.id === id);

            if (!route) {
                return new Response(JSON.stringify({ success: false, message: 'Route not found' }), { status: 404 });
            }

            // Clear cache for this route
            route.cachedBusTimes = undefined;
            route.cacheTimestamp = undefined;
            await saveRoutes(routes);

            console.log(`Cache invalidated for route: ${route.routeNumber} ${route.direction} - ${route.stationName}`);
            return new Response(JSON.stringify({ success: true }));
        }

        if (url.pathname === '/api/scrape-line' && method === 'POST') {
            try {
                const { masterUrl } = await req.json();
                console.log('🌐 [API] /api/scrape-line called');
                console.log('🌐 [API] masterUrl:', masterUrl);

                if (!masterUrl) {
                    console.error('❌ [API] Missing masterUrl in request');
                    return new Response(JSON.stringify({ message: 'masterUrl is required' }), { status: 400 });
                }

                console.log(`📡 [API] Scraping line metadata from: ${masterUrl}`);
                const metadata = await scrapeLineMetadata(masterUrl);
                console.log('✅ [API] Scrape successful:', metadata.lineName, '-', metadata.stations.length, 'stations');

                return new Response(JSON.stringify(metadata), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error('❌ [API] Error scraping line metadata:', error);
                return new Response(JSON.stringify({
                    message: 'Failed to scrape line metadata',
                    error: error instanceof Error ? error.message : 'Unknown error'
                }), { status: 500 });
            }
        }

        // --- PAGE ROUTES ---
        if (url.pathname === '/add-line') {
            const addLineHtml = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Adaugă Linie - RATBV</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; } 
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; padding: 20px; } 
                .container { max-width: 900px; margin: 0 auto; } 
                .header { background: white; border-radius: 15px; padding: 30px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } 
                h1 { color: #333; font-size: 2.5em; margin-bottom: 10px; } 
                .nav-links { margin-top: 15px; } 
                .nav-links a { color: #6366f1; text-decoration: none; margin-right: 20px; font-weight: 500; }
                .step-section { background: white; border-radius: 15px; padding: 30px; margin-bottom: 20px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); }
                .step-section h2 { color: #333; margin-bottom: 20px; font-size: 1.5em; }
                .form-group { margin-bottom: 20px; } 
                label { display: block; color: #666; margin-bottom: 8px; font-weight: 500; } 
                input, select { width: 100%; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 1em; } 
                input:focus, select:focus { outline: none; border-color: #6366f1; }
                .btn { background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 1em; font-weight: bold; cursor: pointer; transition: background 0.3s; } 
                .btn:hover:not(:disabled) { background: #4f46e5; }
                .btn:disabled { background: #9ca3af; cursor: not-loading; }
                .btn-success { background: #10b981; }
                .btn-success:hover:not(:disabled) { background: #059669; }
                .hidden { display: none; }
                .loading { display: inline-block; margin-left: 10px; }
                .station-list { max-height: 400px; overflow-y: auto; }
                .station-item { padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s; }
                .station-item:hover { border-color: #6366f1; background: #f3f4f6; }
                .station-item.selected { border-color: #6366f1; background: #eef2ff; }
                .direction-selector { display: flex; gap: 15px; margin-bottom: 20px; }
                .direction-option { flex: 1; padding: 15px; border: 2px solid #e5e7eb; border-radius: 8px; cursor: pointer; text-align: center; transition: all 0.2s; }
                .direction-option:hover { border-color: #6366f1; }
                .direction-option.selected { border-color: #6366f1; background: #eef2ff; font-weight: bold; }
                .info-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                .success-box { background: #d1fae5; border-left: 4px solid #10b981; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            </style></head><body><div class="container"><div class="header"><h1>🚍 Adaugă Linie Nouă</h1><p style="color: #666;">Completează formularul pentru a adăuga o linie de autobuz</p><div class="nav-links"><a href="/dashboard">← Înapoi la Dashboard</a></div></div>
            
            <!-- Step 1: Input Route Number -->
            <div class="step-section" id="step1">
                <h2>Pasul 1: Introdu Numărul Liniei</h2>
                <div class="info-box">
                    <strong>ℹ️ Exemplu:</strong> 23b
                </div>
                <div class="form-group">
                    <label>Număr Linie (ex: 23b, 5, 12)</label>
                    <input type="text" id="routeNumber" placeholder="23b" required>
                </div>
                <button class="btn" id="scrapeBtn" onclick="scrapeLine()">📡 Scanează Linia</button>
            </div>

            <!-- Step 2: Select Station & Direction -->
            <div class="step-section hidden" id="step2">
                <h2>Pasul 2: Selectează Stația și Direcția</h2>
                <div class="success-box" id="lineInfo"></div>
                
                <h3 style="margin-bottom: 15px;">Direcție</h3>
                <div class="direction-selector">
                    <div class="direction-option selected" data-direction="dus" onclick="selectDirection('dus')">
                        <div style="font-size: 2em; margin-bottom: 5px;">➡️</div>
                        <div>Dus (Implicit)</div>
                    </div>
                    <div class="direction-option" data-direction="intors" onclick="selectDirection('intors')">
                        <div style="font-size: 2em; margin-bottom: 5px;">⬅️</div>
                        <div>Întors</div>
                    </div>
                </div>

                <h3 style="margin-bottom: 15px;">Selectează Stația</h3>
                <div class="station-list" id="stationList"></div>
                
                <button class="btn btn-success" id="addRouteBtn" onclick="addRoute()" disabled>✅ Adaugă Rută</button>
            </div>

            </div>
            <script>
                let lineMetadata = null;
                let lineMetadataIntors = null;
                let selectedStation = null;
                let selectedDirection = 'dus';

                function renderStations() {
                    console.log('🎨 [RENDER] renderStations() called');
                    console.log('🎨 [RENDER] lineMetadata:', lineMetadata);
                    console.log('🎨 [RENDER] selectedDirection:', selectedDirection);
                    
                    if (!lineMetadata) {
                        console.warn('⚠️  [RENDER] No lineMetadata available');
                        return;
                    }
                    
                    // Get the appropriate metadata based on direction
                    const currentMetadata = selectedDirection === 'intors' ? lineMetadataIntors : lineMetadata;
                    console.log('🎨 [RENDER] currentMetadata:', currentMetadata);
                    
                    if (!currentMetadata) {
                        console.warn('⚠️  [RENDER] No currentMetadata available');
                        return;
                    }
                    
                    const stations = currentMetadata.stations;
                    console.log('🎨 [RENDER] Rendering', stations.length, 'stations for direction:', selectedDirection);
                    
                    const stationList = document.getElementById('stationList');
                    stationList.innerHTML = stations.map((station, index) => 
                        \`<div class="station-item" data-index="\${index}" data-route="\${station.route}" onclick="selectStation(\${index})">
                            <strong>\${station.name}</strong><br>
                            <small style="color: #666;">ID: \${station.route}</small>
                        </div>\`
                    ).join('');
                    
                    console.log('✅ [RENDER] Stations rendered successfully');
                    
                    // Clear selection when switching direction
                    selectedStation = null;
                    document.getElementById('addRouteBtn').disabled = true;
                }

                async function scrapeLine() {
                    const routeNumber = document.getElementById('routeNumber').value.trim().toLowerCase();
                    console.log('🚀 [SCRAPER] Starting scrape for route:', routeNumber);
                    
                    if (!routeNumber) {
                        console.error('❌ [SCRAPER] No route number provided');
                        alert('Te rog introdu numărul liniei (ex: 23b)!');
                        return;
                    }

                    const scrapeBtn = document.getElementById('scrapeBtn');
                    
                    scrapeBtn.disabled = true;
                    scrapeBtn.textContent = '⏳ Se încarcă...';

                    try {
                        // Build URLs automatically from route number
                        const dusUrl = \`https://www.ratbv.ro/afisaje/\${routeNumber}-dus.html\`;
                        const intorsUrl = \`https://www.ratbv.ro/afisaje/\${routeNumber}-intors.html\`;
                        
                        console.log('🔗 [SCRAPER] Built URLs:');
                        console.log('  ➡️  DUS:', dusUrl);
                        console.log('  ⬅️  INTORS:', intorsUrl);
                        console.log('🔗 [SCRAPER] Built URLs:');
                        console.log('  ➡️  DUS:', dusUrl);
                        console.log('  ⬅️  INTORS:', intorsUrl);

                        // Scrape DUS direction
                        console.log('📡 [SCRAPER] Fetching DUS direction...');
                        const responseDus = await fetch('/api/scrape-line', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ masterUrl: dusUrl })
                        });

                        console.log('📥 [SCRAPER] DUS Response status:', responseDus.status);
                        
                        if (!responseDus.ok) {
                            const error = await responseDus.json();
                            console.error('❌ [SCRAPER] DUS failed:', error);
                            throw new Error(error.message || 'Failed to scrape dus direction');
                        }

                        lineMetadata = await responseDus.json();
                        lineMetadata.masterUrl = dusUrl;
                        console.log('✅ [SCRAPER] DUS data received:', lineMetadata.lineName, '-', lineMetadata.stations.length, 'stations');
                        
                        // Scrape INTORS direction
                        console.log('📡 [SCRAPER] Fetching INTORS direction...');
                        const responseIntors = await fetch('/api/scrape-line', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ masterUrl: intorsUrl })
                        });

                        console.log('📥 [SCRAPER] INTORS Response status:', responseIntors.status);

                        if (responseIntors.ok) {
                            lineMetadataIntors = await responseIntors.json();
                            lineMetadataIntors.masterUrl = intorsUrl;
                            console.log('✅ [SCRAPER] INTORS data received:', lineMetadataIntors.lineName, '-', lineMetadataIntors.stations.length, 'stations');
                        } else {
                            // If intors fails, use reversed dus as fallback
                            console.warn('⚠️  [SCRAPER] Failed to fetch intors, using reversed dus as fallback');
                            lineMetadataIntors = {
                                lineName: lineMetadata.lineName,
                                stations: [...lineMetadata.stations].reverse(),
                                masterUrl: intorsUrl
                            };
                        }
                        
                        console.log('📊 [SCRAPER] Station counts:');
                        console.log('  ➡️  Dus stations:', lineMetadata.stations.length);
                        console.log('  ⬅️  Intors stations:', lineMetadataIntors.stations.length);
                        console.log('📋 [SCRAPER] Full station data:', { dus: lineMetadata.stations, intors: lineMetadataIntors.stations });
                        
                        // Show step 2
                        console.log('🎨 [SCRAPER] Rendering step 2...');
                        document.getElementById('lineInfo').innerHTML = 
                            \`<strong>✅ Linie găsită:</strong> \${lineMetadata.lineName}<br>
                            <strong>📍 Stații Dus:</strong> \${lineMetadata.stations.length} • <strong>Întors:</strong> \${lineMetadataIntors.stations.length}<br>
                            <small style="color: #666;">Dus URL: \${dusUrl}<br>Întors URL: \${intorsUrl}</small>\`;
                        
                        // Populate stations
                        renderStations();

                        document.getElementById('step2').classList.remove('hidden');
                        console.log('✅ [SCRAPER] Scrape completed successfully!');
                        
                    } catch (error) {
                        console.error('❌ [SCRAPER] Error occurred:', error);
                        alert('Eroare: ' + error.message);
                    } finally {
                        scrapeBtn.disabled = false;
                        scrapeBtn.textContent = '📡 Scanează Linia';
                    }
                }

                function selectDirection(direction) {
                    console.log('🔄 [DIRECTION] Switching direction to:', direction);
                    selectedDirection = direction;
                    document.querySelectorAll('.direction-option').forEach(el => {
                        el.classList.remove('selected');
                    });
                    document.querySelector(\`.direction-option[data-direction="\${direction}"]\`).classList.add('selected');
                    
                    // Re-render stations with the appropriate metadata
                    console.log('🔄 [DIRECTION] Re-rendering stations for new direction');
                    renderStations();
                }

                function selectStation(index) {
                    console.log('🎯 [STATION] Station selected at index:', index);
                    console.log('🎯 [STATION] Current direction:', selectedDirection);
                    
                    // Get the current metadata based on direction
                    const currentMetadata = selectedDirection === 'intors' ? lineMetadataIntors : lineMetadata;
                    console.log('🎯 [STATION] Current metadata:', currentMetadata);
                    
                    selectedStation = currentMetadata.stations[index];
                    console.log('🎯 [STATION] Selected station:', selectedStation);
                    
                    document.querySelectorAll('.station-item').forEach(el => {
                        el.classList.remove('selected');
                    });
                    document.querySelector(\`.station-item[data-index="\${index}"]\`).classList.add('selected');
                    
                    document.getElementById('addRouteBtn').disabled = false;
                    console.log('✅ [STATION] Station selection complete');
                }

                async function addRoute() {
                    console.log('➕ [ADD ROUTE] Starting addRoute()');
                    console.log('➕ [ADD ROUTE] selectedStation:', selectedStation);
                    
                    if (!selectedStation) {
                        console.error('❌ [ADD ROUTE] No station selected');
                        alert('Te rog selectează o stație!');
                        return;
                    }

                    const addBtn = document.getElementById('addRouteBtn');
                    addBtn.disabled = true;
                    addBtn.textContent = '⏳ Se adaugă...';

                    try {
                        // Get direction labels from first and last stations
                        const firstStation = lineMetadata.stations[0].name;
                        const lastStation = lineMetadata.stations[lineMetadata.stations.length - 1].name;
                        
                        const directionFrom = selectedDirection === 'dus' ? firstStation : lastStation;
                        const directionTo = selectedDirection === 'dus' ? lastStation : firstStation;

                        console.log('📍 [ADD ROUTE] Direction labels:', { directionFrom, directionTo });

                        // Extract route number from the master URL
                        // Example: https://www.ratbv.ro/afisaje/23b-dus.html -> 23b
                        const currentMetadata = selectedDirection === 'intors' ? lineMetadataIntors : lineMetadata;
                        const masterUrl = currentMetadata.masterUrl;
                        const routeNumberMatch = masterUrl.match(/afisaje\\/([^-]+)-/);
                        const routeNumber = routeNumberMatch ? routeNumberMatch[1] : '';

                        console.log('🔢 [ADD ROUTE] Extracted route number:', routeNumber, 'from', masterUrl);

                        // Extract station slug from the station link
                        // Example: .../line_23b_4_cl1_ro.html -> 4
                        const stationLink = selectedStation.link;
                        const stationSlugMatch = stationLink.match(/line_[^_]+_([^_]+)_/);
                        const stationSlug = stationSlugMatch ? stationSlugMatch[1] : selectedStation.route;

                        console.log('🏷️  [ADD ROUTE] Extracted station slug:', stationSlug, 'from', stationLink);

                        // Use the actual URL from the scraper
                        const stationUrl = selectedStation.link;

                        // Create route object
                        const routeData = {
                            id: \`\${routeNumber}-\${stationSlug}-\${selectedDirection}\`,
                            routeNumber: routeNumber,
                            direction: selectedDirection,
                            stationName: selectedStation.name,
                            stationSlug: stationSlug,
                            url: stationUrl,
                            directionFrom: directionFrom,
                            directionTo: directionTo
                        };

                        console.log('📦 [ADD ROUTE] Route data to send:', routeData);

                        console.log('📡 [ADD ROUTE] Sending POST request to /api/routes...');
                        const response = await fetch('/api/routes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(routeData)
                        });

                        console.log('📥 [ADD ROUTE] Response status:', response.status);

                        if (response.ok) {
                            console.log('✅ [ADD ROUTE] Route added successfully!');
                            alert('✅ Rută adăugată cu succes!');
                            window.location.href = '/dashboard';
                        } else {
                            const error = await response.json();
                            console.error('❌ [ADD ROUTE] Failed to add route:', error);
                            alert('Eroare: ' + error.message);
                            addBtn.disabled = false;
                            addBtn.textContent = '✅ Adaugă Rută';
                        }
                    } catch (error) {
                        console.error('❌ [ADD ROUTE] Exception caught:', error);
                        alert('Eroare la adăugarea rutei: ' + error.message);
                        addBtn.disabled = false;
                        addBtn.textContent = '✅ Adaugă Rută';
                    }
                }
            </script></body></html>`;
            return new Response(addLineHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (url.pathname === '/dashboard') {
            const routes = await loadRoutes();
            const dashboardHtml = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard - RATBV Routes</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; } 
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; padding: 20px; } 
                .container { max-width: 1200px; margin: 0 auto; } 
                .header { background: white; border-radius: 15px; padding: 30px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } 
                h1 { color: #333; font-size: 2.5em; margin-bottom: 10px; } 
                .nav-links { margin-top: 15px; } 
                .nav-links a { color: #6366f1; text-decoration: none; margin-right: 20px; font-weight: 500; } 
                .form-section { background: white; border-radius: 15px; padding: 30px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } 
                .form-section h2 { color: #333; margin-bottom: 20px; } 
                .form-group { margin-bottom: 20px; } 
                label { display: block; color: #666; margin-bottom: 8px; font-weight: 500; } 
                input, select { width: 100%; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 1em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; } 
                input:focus, select:focus { outline: none; border-color: #6366f1; } 
                .direction-group { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: end; } 
                .direction-group input { margin: 0; } 
                .arrow { font-size: 1.5em; color: #6366f1; padding-bottom: 12px; text-align: center; } 
                .btn { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 1em; font-weight: bold; cursor: pointer; transition: background 0.3s; display: inline-block; text-decoration: none; } 
                .btn:hover { background: #4f46e5; } 
                .btn-big { padding: 20px 40px; font-size: 1.3em; width: 100%; text-align: center; background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3); } 
                .btn-big:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(16, 185, 129, 0.4); } 
                .toggle-manual { text-align: center; margin-top: 20px; padding-top: 20px; border-top: 2px solid #e5e7eb; } 
                .toggle-manual a { color: #6366f1; text-decoration: none; font-weight: 500; cursor: pointer; } 
                .toggle-manual a:hover { text-decoration: underline; } 
                .manual-form { display: none; margin-top: 20px; padding-top: 20px; border-top: 2px solid #e5e7eb; } 
                .manual-form.show { display: block; } 
                .routes-list { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } 
                .routes-list h2 { color: #333; margin-bottom: 20px; } 
                .route-item { border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 15px; } 
                .route-info { flex: 1; min-width: 200px; } 
                .route-info h3 { color: #333; margin-bottom: 5px; } 
                .route-info p { color: #666; font-size: 0.9em; } 
                .route-actions { display: flex; gap: 10px; flex-wrap: wrap; } 
                .btn-small { padding: 10px 20px; font-size: 0.95em; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; } 
                .btn-view { background: #10b981; } 
                .btn-view:hover { background: #059669; } 
                .btn-delete { background: #ef4444; } 
                .btn-delete:hover { background: #dc2626; } 
                .empty-state { text-align: center; color: #999; padding: 40px; } 
                .direction-badge { display: inline-block; background: #6366f1; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.75em; margin-left: 8px; } 
                .highlight-box { background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%); border: 2px solid #3b82f6; border-radius: 12px; padding: 20px; margin-bottom: 25px; text-align: center; } 
                .highlight-box p { color: #1e40af; margin-bottom: 15px; font-size: 1.1em; }
                /* --- MOBILE IMPROVEMENTS --- */
                @media (max-width: 600px) {
                  body { padding: 10px; }
                  .container { padding: 0; }
                  .header { padding: 20px; margin-bottom: 15px; }
                  h1 { font-size: 1.8em; }
                  .form-section, .routes-list { padding: 20px; margin-bottom: 15px; }
                  .route-item { flex-direction: column; align-items: stretch; padding: 15px; gap: 12px; }
                  .route-info { min-width: 100%; }
                  .route-info h3 { font-size: 1.15em; margin-bottom: 8px; }
                  .route-info p { font-size: 0.9em; line-height: 1.5; }
                  .direction-badge { display: block; margin-left: 0; margin-top: 5px; width: fit-content; }
                  .route-actions { width: 100%; gap: 8px; margin-top: 5px; }
                  .btn-small { flex: 1; min-width: 0; font-size: 0.95em; padding: 12px 8px; text-align: center; }
                  .highlight-box { padding: 15px; }
                  .btn-big { font-size: 1.1em; padding: 16px 20px; }
                }
            </style></head><body><div class="container"><div class="header"><h1>🎛️ Dashboard</h1><p style="color: #666;">Administrează rutele de autobuze</p><div class="nav-links"><a href="/">← Înapoi la Home</a></div></div><div class="form-section"><h2>➕ Adaugă Rută Nouă</h2><div class="highlight-box"><p>🎯 <strong>Recomandat:</strong> Folosește scraper-ul automat pentru a adăuga linii rapid și ușor!</p><a href="/add-line" class="btn btn-big">🚍 Adaugă Linie cu Scraper</a></div><div class="toggle-manual"><a onclick="document.getElementById('manualForm').classList.toggle('show'); this.textContent = document.getElementById('manualForm').classList.contains('show') ? '▲ Ascunde formularul manual' : '▼ Adaugă manual (avansat)'">▼ Adaugă manual (avansat)</a></div><div id="manualForm" class="manual-form"><form id="addRouteForm"><div class="form-group"><label>ID Rută (ex: 4-dus)</label><input type="text" name="id" required placeholder="4-dus"></div><div class="form-group"><label>Număr Rută (ex: 23b)</label><input type="text" name="routeNumber" required placeholder="23b"></div><div class="form-group"><label>Direcție</label><select name="direction" required><option value="dus">Dus</option><option value="intors">Întors</option></select></div><div class="form-group"><label>Nume Stație</label><input type="text" name="stationName" required placeholder="Sala Sporturilor"></div><div class="form-group"><label>Station Slug (ex: 4)</label><input type="text" name="stationSlug" required placeholder="4"></div><div class="form-group"><label>URL Complet</label><input type="url" name="url" required placeholder="https://www.ratbv.ro/afisaje/23b-dus/line_23b_4_cl1_ro.html"></div><div class="form-group"><label>Direcție (opțional)</label><div class="direction-group"><input type="text" name="directionFrom" placeholder="De la (ex: Centru)"><div class="arrow">→</div><input type="text" name="directionTo" placeholder="Către (ex: Noua)"></div></div><button type="submit" class="btn">Adaugă Rută</button></form></div></div><div class="routes-list"><h2>📋 Rute Existente</h2>${routes.length > 0 ? routes.map(route => `<div class="route-item"><div class="route-info"><h3>${route.routeNumber.toUpperCase()}${route.directionFrom && route.directionTo ? `<span class="direction-badge">${route.directionFrom} → ${route.directionTo}</span>` : ''}</h3><p>📍 ${route.stationName} • ${route.direction} • ID: ${route.id}</p><p style="font-size: 0.8em; margin-top: 5px; word-break: break-all;">/${route.routeNumber}/${route.direction}/${route.stationSlug}</p></div><div class="route-actions"><a href="/${route.routeNumber}/${route.direction}/${route.stationSlug}" class="btn btn-small btn-view">Vezi</a><button onclick="deleteRoute('${route.id}')" class="btn btn-small btn-delete">Șterge</button></div></div>`).join('') : '<div class="empty-state">Nu există rute adăugate încă</div>'}</div></div>
            <script>
                document.getElementById('addRouteForm').addEventListener('submit', async (e) => { e.preventDefault(); const formData = new FormData(e.target); const data = Object.fromEntries(formData); try { const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { alert('Rută adăugată cu succes!'); window.location.reload(); } else { const error = await response.json(); alert('Eroare: ' + error.message); } } catch (error) { alert('Eroare la adăugarea rutei'); } });
                async function deleteRoute(id) { if (!confirm('Sigur vrei să ștergi această rută?')) return; try { const response = await fetch('/api/routes/' + id, { method: 'DELETE' }); if (response.ok) { alert('Rută ștearsă cu succes!'); window.location.reload(); } else { alert('Eroare la ștergerea rutei'); } } catch (error) { alert('Eroare la ștergerea rutei'); } }
            </script></body></html>`;
            return new Response(dashboardHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const pathParts = url.pathname.split('/').filter(p => p);
    if(pathParts.length === 3) {
        const [routeNumber, direction, stationSlug] = pathParts;

// Validate direction
if (direction !== 'dus' && direction !== 'intors') {
    return new Response('<h1>Direcție invalidă</h1><p>Direcția trebuie să fie "dus" sau "intors"</p><a href="/">Înapoi</a>', {
        status: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

const routes = await loadRoutes();
const route = routes.find(r =>
    r.routeNumber === routeNumber &&
    r.direction === direction &&
    r.stationSlug === stationSlug
);

if (!route) {
    return new Response('<h1>Rută negăsită</h1><a href="/">Înapoi</a>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

try {
    const now = Date.now();
    let busTimes: string[];
    let isCached = false;
    let cacheAge = 0;

    // Check if we have valid cached data in the route object
    if (route.cachedBusTimes && route.cacheTimestamp && (now - route.cacheTimestamp) < CACHE_DURATION) {
        console.log(`Using cached data for ${route.routeNumber} ${route.direction} - ${route.stationName} (age: ${Math.round((now - route.cacheTimestamp) / 1000)}s)`);
        busTimes = route.cachedBusTimes;
        isCached = true;
        cacheAge = now - route.cacheTimestamp;
    } else {
        console.log(`Scraping fresh bus times for ${route.routeNumber} ${route.direction} - ${route.stationName}...`);
        busTimes = await scrapeBusTimes(route.url);

        // Update cache in the route object and save to file
        route.cachedBusTimes = busTimes;
        route.cacheTimestamp = now;
        await saveRoutes(routes);
    }

    const currentTime = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });

    const html = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${route.routeNumber.toUpperCase()} - ${route.stationName}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; } .container { background: white; border-radius: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); max-width: 800px; width: 100%; padding: 40px; animation: slideIn 0.5s ease-out; } @keyframes slideIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } } .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #6366f1; padding-bottom: 20px; } .header h1 { color: #333; font-size: 2.5em; margin-bottom: 10px; } .route-badge { display: inline-block; background: #6366f1; color: white; padding: 8px 20px; border-radius: 25px; font-size: 1.2em; font-weight: bold; margin-bottom: 10px; } .direction-info { color: #6366f1; font-size: 1.1em; margin-top: 8px; font-weight: 500; } .direction-info::before { content: "🚏 "; } .location { color: #666; font-size: 1.3em; margin-top: 10px; } .location::before { content: "📍 "; } .timestamp { color: #888; font-size: 0.9em; margin-top: 10px; } .cache-badge { display: inline-block; background: #10b981; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.8em; margin-left: 10px; } .action-buttons { display: flex; gap: 10px; justify-content: center; margin-bottom: 25px; flex-wrap: wrap; } .times-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 30px; } .time-card { background: #6366f1; color: white; padding: 12px; border-radius: 12px; text-align: center; font-size: 1.1em; font-weight: bold; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; } .time-card:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.5); } .time-card.next-bus { background: #ef4444; box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4); animation: pulse 2s infinite; } @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } } .no-times { text-align: center; color: #666; font-size: 1.2em; padding: 40px; } .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #888; } .btn { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 25px; font-size: 1em; font-weight: bold; cursor: pointer; margin: 0; transition: background 0.3s; text-decoration: none; display: inline-block; } .btn:hover { background: #4f46e5; } .btn-delete { background: #ef4444; } .btn-delete:hover { background: #dc2626; } @media (max-width: 600px) { .container { padding: 20px; } .header h1 { font-size: 1.8em; } .action-buttons { gap: 8px; } .btn { padding: 10px 20px; font-size: 0.95em; } .times-grid { grid-template-columns: repeat(4, 1fr); gap: 8px; } .time-card { font-size: 1em; padding: 12px 8px; } }
            </style></head><body><div class="container"><div class="header"><h1>🚌 RATBV Bus Times</h1><div class="route-badge">${route.routeNumber.toUpperCase()}</div>${route.directionFrom && route.directionTo ? `<div class="direction-info">${route.directionFrom} → ${route.directionTo}</div>` : ''}<div class="location">${route.stationName}</div><div class="timestamp">Actualizat: ${currentTime}${isCached ? ` <span class="cache-badge">📦 Cache (${Math.round(cacheAge / 1000)}s)</span>` : ' <span class="cache-badge" style="background: #ef4444;">🔴 Live</span>'}</div></div><div class="action-buttons"><button class="btn" onclick="refreshCache()">🔄 Actualizează</button><a href="/" class="btn">🏠 Înapoi la Home</a><button class="btn btn-delete" onclick="deleteRoute()">🗑️ Șterge Rută</button></div>${busTimes.length > 0 ? `<div class="times-grid">${busTimes.map((time, index) => { const [hour, minute] = time.split(':'); const now = new Date(); const busTime = new Date(); busTime.setHours(parseInt(hour), parseInt(minute), 0); const isNext = busTime > now && index === busTimes.findIndex(t => { const [h, m] = t.split(':'); const bt = new Date(); bt.setHours(parseInt(h), parseInt(m), 0); return bt > now; }); return `<div class="time-card ${isNext ? 'next-bus' : ''}">${time}</div>`; }).join('')}</div>` : `<div class="no-times">Nu sunt curse disponibile în acest moment.</div>`}
            <div class="footer"><p style="margin-top: 15px;">Date live de la RATBV Brașov</p></div></div>
            <script>
                async function refreshCache() {
                    const btn = event.target;
                    btn.disabled = true;
                    btn.textContent = '⏳ Se încarcă...';
                    try {
                        await fetch('/api/invalidate-cache/${route.id}', { method: 'POST' });
                        window.location.reload();
                    } catch (error) {
                        alert('Eroare la actualizarea datelor');
                        btn.disabled = false;
                        btn.textContent = '🔄 Actualizează';
                    }
                }
                
                async function deleteRoute() {
                    if (!confirm('Sigur vrei să ștergi această rută? Această acțiune nu poate fi anulată.')) return;
                    try {
                        const response = await fetch('/api/routes/${route.id}', { method: 'DELETE' });
                        if (response.ok) {
                            alert('Rută ștearsă cu succes!');
                            window.location.href = '/';
                        } else {
                            alert('Eroare la ștergerea rutei');
                        }
                    } catch (error) {
                        alert('Eroare la ștergerea rutei');
                    }
                }
            </script></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
} catch (error) {
    const errorHtml = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Error - Bus Times</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; } .error-container { background: white; border-radius: 20px; padding: 40px; text-align: center; max-width: 500px; } h1 { color: #ef4444; font-size: 3em; margin-bottom: 20px; } p { color: #666; font-size: 1.2em; } .btn { background: #6366f1; color: white; padding: 12px 30px; border-radius: 25px; text-decoration: none; display: inline-block; margin-top: 20px; }
            </style></head><body><div class="error-container"><h1>😕 Oops!</h1><p>A apărut o eroare la încărcarea datelor.</p><p style="font-size: 0.9em; color: #999; margin-top: 10px;">${error instanceof Error ? error.message : 'Unknown error'}</p><a href="/" class="btn">🏠 Înapoi la Home</a></div></body></html>`;
    return new Response(errorHtml, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
    }

// --- HOMEPAGE ROUTE ---
const routes = await loadRoutes();
const indexHtml = `
    <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>RATBV Bus Times</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; padding: 20px; } .container { max-width: 1000px; margin: 0 auto; } .header { background: white; border-radius: 20px; padding: 40px; text-align: center; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); margin-bottom: 30px; } h1 { color: #333; font-size: 3em; margin-bottom: 10px; } .subtitle { color: #666; font-size: 1.2em; margin-bottom: 20px; } .dashboard-link { display: inline-block; background: #10b981; color: white; padding: 12px 25px; border-radius: 25px; text-decoration: none; font-weight: bold; transition: background 0.3s; } .dashboard-link:hover { background: #059669; } .routes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; } .route-card { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); transition: transform 0.2s, box-shadow 0.2s; text-decoration: none; display: block; } .route-card:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15); } .route-card h2 { color: #333; font-size: 1.5em; margin-bottom: 10px; } .route-card p { color: #666; font-size: 1.1em; } .route-card p::before { content: "📍 "; } .empty-state { background: white; border-radius: 15px; padding: 60px 40px; text-align: center; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } .empty-state h2 { color: #333; margin-bottom: 20px; } .empty-state p { color: #666; margin-bottom: 30px; } @media (max-width: 600px) { h1 { font-size: 2em; } .routes-grid { grid-template-columns: 1fr; } }
    </style></head><body><div class="container"><div class="header"><h1>🚌 RATBV Bus Times</h1><p class="subtitle">Orarul autobuzelor în timp real</p><a href="/dashboard" class="dashboard-link">⚙️ Dashboard Admin</a></div>
    ${routes.length > 0 ? `<div class="routes-grid">${routes.map(route => `<a href="/${route.routeNumber}/${route.direction}/${route.stationSlug}" class="route-card"><h2>${route.routeNumber.toUpperCase()}</h2><p>${route.stationName}</p>${route.directionFrom && route.directionTo ? `<p style="color: #6366f1; font-size: 0.9em; margin-top: 8px;">🚏 ${route.directionFrom} → ${route.directionTo}</p>` : ''}</a>`).join('')}</div>`
        : `<div class="empty-state"><h2>Nu există rute configurate</h2><p>Accesează dashboard-ul pentru a adăuga prima rută</p><a href="/dashboard" class="dashboard-link">Mergi la Dashboard</a></div>`}
    </div></body></html>`;
return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
});

console.log(`🚀 Server running on http://localhost:${server.port}`);