import { Builder, Browser, By, WebDriver } from 'selenium-webdriver';
import { Options as ChromeOptions, ServiceBuilder } from 'selenium-webdriver/chrome';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// --- CONFIGURATION & TYPES ---

const ROUTES_FILE = join(import.meta.dir, 'routes.json');
const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "/usr/bin/chromedriver";

interface Route {
  id: string;
  name: string;
  stationName: string;
  url: string;
}

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
  port: 6942,
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
            const routes = await loadRoutes();
            if (routes.some(r => r.id === newRoute.id)) {
                return new Response(JSON.stringify({ message: 'ID already exists' }), { status: 400 });
            }
            routes.push(newRoute);
            await saveRoutes(routes);
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        } catch {
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

    // --- PAGE ROUTES ---
    if (url.pathname === '/dashboard') {
        const routes = await loadRoutes();
        const dashboardHtml = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard - RATBV Routes</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; padding: 20px; } .container { max-width: 1200px; margin: 0 auto; } .header { background: white; border-radius: 15px; padding: 30px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } h1 { color: #333; font-size: 2.5em; margin-bottom: 10px; } .nav-links { margin-top: 15px; } .nav-links a { color: #6366f1; text-decoration: none; margin-right: 20px; font-weight: 500; } .form-section { background: white; border-radius: 15px; padding: 30px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } .form-section h2 { color: #333; margin-bottom: 20px; } .form-group { margin-bottom: 20px; } label { display: block; color: #666; margin-bottom: 8px; font-weight: 500; } input { width: 100%; padding: 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 1em; } input:focus { outline: none; border-color: #6366f1; } .btn { background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 8px; font-size: 1em; font-weight: bold; cursor: pointer; transition: background 0.3s; } .btn:hover { background: #4f46e5; } .routes-list { background: white; border-radius: 15px; padding: 30px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); } .routes-list h2 { color: #333; margin-bottom: 20px; } .route-item { border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; } .route-info h3 { color: #333; margin-bottom: 5px; } .route-info p { color: #666; font-size: 0.9em; } .route-actions { display: flex; gap: 10px; } .btn-small { padding: 8px 16px; font-size: 0.9em; } .btn-view { background: #10b981; } .btn-view:hover { background: #059669; } .btn-delete { background: #ef4444; } .btn-delete:hover { background: #dc2626; } .empty-state { text-align: center; color: #999; padding: 40px; }
            </style></head><body><div class="container"><div class="header"><h1>🎛️ Dashboard</h1><p style="color: #666;">Administrează rutele de autobuze</p><div class="nav-links"><a href="/">← Înapoi la Home</a></div></div><div class="form-section"><h2>➕ Adaugă Rută Nouă</h2><form id="addRouteForm"><div class="form-group"><label>ID Rută (ex: sala-sporturilor)</label><input type="text" name="id" required placeholder="sala-sporturilor"></div><div class="form-group"><label>Nume Rută (ex: Linia 23B)</label><input type="text" name="name" required placeholder="Linia 23B"></div><div class="form-group"><label>Nume Stație</label><input type="text" name="stationName" required placeholder="Sala Sporturilor"></div><div class="form-group"><label>URL RATBV</label><input type="url" name="url" required placeholder="https://www.ratbv.ro/afisaje/..."></div><button type="submit" class="btn">Adaugă Rută</button></form></div><div class="routes-list"><h2>📋 Rute Existente</h2>${routes.length > 0 ? routes.map(route => `<div class="route-item"><div class="route-info"><h3>${route.name}</h3><p>📍 ${route.stationName} • ID: ${route.id}</p><p style="font-size: 0.8em; margin-top: 5px; word-break: break-all;">${route.url}</p></div><div class="route-actions"><a href="/route/${route.id}" class="btn btn-small btn-view">Vezi</a><button onclick="deleteRoute('${route.id}')" class="btn btn-small btn-delete">Șterge</button></div></div>`).join('') : '<div class="empty-state">Nu există rute adăugate încă</div>'}</div></div>
            <script>
                document.getElementById('addRouteForm').addEventListener('submit', async (e) => { e.preventDefault(); const formData = new FormData(e.target); const data = Object.fromEntries(formData); try { const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (response.ok) { alert('Rută adăugată cu succes!'); window.location.reload(); } else { const error = await response.json(); alert('Eroare: ' + error.message); } } catch (error) { alert('Eroare la adăugarea rutei'); } });
                async function deleteRoute(id) { if (!confirm('Sigur vrei să ștergi această rută?')) return; try { const response = await fetch('/api/routes/' + id, { method: 'DELETE' }); if (response.ok) { alert('Rută ștearsă cu succes!'); window.location.reload(); } else { alert('Eroare la ștergerea rutei'); } } catch (error) { alert('Eroare la ștergerea rutei'); } }
            </script></body></html>`;
        return new Response(dashboardHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (url.pathname.startsWith('/route/')) {
        const routeId = url.pathname.split('/route/')[1];
        const routes = await loadRoutes();
        const route = routes.find(r => r.id === routeId);

        if (!route) {
            return new Response('<h1>Rută negăsită</h1><a href="/">Înapoi</a>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        try {
            console.log(`Scraping bus times for ${route.name}...`);
            const busTimes = await scrapeBusTimes(route.url);
            const currentTime = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });

            const html = `
            <!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${route.name} - ${route.stationName}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #6366f1; min-height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; } .container { background: white; border-radius: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2); max-width: 800px; width: 100%; padding: 40px; animation: slideIn 0.5s ease-out; } @keyframes slideIn { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } } .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #6366f1; padding-bottom: 20px; } .header h1 { color: #333; font-size: 2.5em; margin-bottom: 10px; } .route-badge { display: inline-block; background: #6366f1; color: white; padding: 8px 20px; border-radius: 25px; font-size: 1.2em; font-weight: bold; margin-bottom: 10px; } .location { color: #666; font-size: 1.3em; margin-top: 10px; } .location::before { content: "📍 "; } .timestamp { color: #888; font-size: 0.9em; margin-top: 10px; } .times-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 15px; margin-top: 30px; } .time-card { background: #6366f1; color: white; padding: 20px; border-radius: 12px; text-align: center; font-size: 1.4em; font-weight: bold; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; } .time-card:hover { transform: translateY(-5px); box-shadow: 0 8px 25px rgba(99, 102, 241, 0.5); } .time-card.next-bus { background: #ef4444; box-shadow: 0 6px 20px rgba(239, 68, 68, 0.4); animation: pulse 2s infinite; } @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } } .no-times { text-align: center; color: #666; font-size: 1.2em; padding: 40px; } .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #888; } .btn { background: #6366f1; color: white; border: none; padding: 12px 30px; border-radius: 25px; font-size: 1em; font-weight: bold; cursor: pointer; margin: 10px 5px; transition: background 0.3s; text-decoration: none; display: inline-block; } .btn:hover { background: #4f46e5; } @media (max-width: 600px) { .container { padding: 20px; } .header h1 { font-size: 1.8em; } .times-grid { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px; } .time-card { font-size: 1.2em; padding: 15px; } }
            </style></head><body><div class="container"><div class="header"><h1>🚌 RATBV Bus Times</h1><div class="route-badge">${route.name}</div><div class="location">${route.stationName}</div><div class="timestamp">Actualizat: ${currentTime}</div></div>${busTimes.length > 0 ? `<div class="times-grid">${busTimes.map((time, index) => { const [hour, minute] = time.split(':'); const now = new Date(); const busTime = new Date(); busTime.setHours(parseInt(hour), parseInt(minute), 0); const isNext = busTime > now && index === busTimes.findIndex(t => { const [h, m] = t.split(':'); const bt = new Date(); bt.setHours(parseInt(h), parseInt(m), 0); return bt > now; }); return `<div class="time-card ${isNext ? 'next-bus' : ''}">${time}</div>`; }).join('')}</div>` : `<div class="no-times">Nu sunt curse disponibile în acest moment.</div>`}
            <div class="footer"><button class="btn" onclick="window.location.reload()">🔄 Actualizează</button><a href="/" class="btn">🏠 Înapoi la Home</a><p style="margin-top: 15px;">Date live de la RATBV Brașov</p></div></div></body></html>`;
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
    ${routes.length > 0 ? `<div class="routes-grid">${routes.map(route => `<a href="/route/${route.id}" class="route-card"><h2>${route.name}</h2><p>${route.stationName}</p></a>`).join('')}</div>`
    : `<div class="empty-state"><h2>Nu există rute configurate</h2><p>Accesează dashboard-ul pentru a adăuga prima rută</p><a href="/dashboard" class="dashboard-link">Mergi la Dashboard</a></div>`}
    </div></body></html>`;
    return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
  error(error) {
    console.error("Server Error:", error);
    return new Response('An unexpected error occurred.', { status: 500 });
  }
});

console.log(`🚌 RATBV Bus Scraper running on http://localhost:${server.port}`);
