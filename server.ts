import { Builder, Browser, By } from 'selenium-webdriver';
import { Options as ChromeOptions, ServiceBuilder } from 'selenium-webdriver/chrome';

const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "/usr/bin/chromedriver";

async function scrapeStationName(url: string): Promise<{ stationName: string; error?: string }> {
    const chromeOptions = new ChromeOptions();
    chromeOptions.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage');
    const service = new ServiceBuilder(CHROMEDRIVER_PATH);
    const driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(chromeOptions)
        .setChromeService(service)
        .build();

    try {
        await driver.get(url);
        await driver.switchTo().frame(2);
        const element = await driver.findElement(By.id('statie_web'));
        const boldElement = await element.findElement(By.tagName('b'));
        const stationName = await boldElement.getText();
        
        return { stationName };
    } catch (error) {
        console.error('Error scraping page:', error);
        return { stationName: '', error: String(error) };
    } finally {
        await driver.quit();
    }
}

const HTML_FORM = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bus Station Scraper</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 600px;
            width: 100%;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 28px;
        }
        p {
            color: #666;
            margin-bottom: 30px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #555;
            font-weight: 500;
        }
        input[type="text"] {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        input[type="text"]:focus {
            outline: none;
            border-color: #667eea;
        }
        button {
            width: 100%;
            padding: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 20px rgba(102, 126, 234, 0.4);
        }
        button:active {
            transform: translateY(0);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        #result {
            margin-top: 30px;
            padding: 20px;
            border-radius: 8px;
            display: none;
        }
        #result.success {
            background: #e8f5e9;
            border: 2px solid #4caf50;
            display: block;
        }
        #result.error {
            background: #ffebee;
            border: 2px solid #f44336;
            display: block;
        }
        .result-title {
            font-weight: 600;
            margin-bottom: 10px;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .result-title.success {
            color: #2e7d32;
        }
        .result-title.error {
            color: #c62828;
        }
        .station-name {
            font-size: 24px;
            color: #333;
            font-weight: 700;
        }
        .error-message {
            color: #c62828;
            font-size: 14px;
        }
        .loading {
            display: none;
            margin-top: 20px;
            text-align: center;
            color: #667eea;
        }
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚌 Bus Station Scraper</h1>
        <p>Enter a RATBV URL to fetch the station name</p>
        
        <form id="scrapeForm">
            <div class="form-group">
                <label for="url">URL:</label>
                <input 
                    type="text" 
                    id="url" 
                    name="url" 
                    placeholder="https://www.ratbv.ro/afisaje/23b-dus.html"
                    required
                >
            </div>
            <button type="submit">Fetch Station Name</button>
        </form>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Scraping data...</p>
        </div>

        <div id="result"></div>
    </div>

    <script>
        const form = document.getElementById('scrapeForm');
        const resultDiv = document.getElementById('result');
        const loadingDiv = document.getElementById('loading');
        const urlInput = document.getElementById('url');
        const submitButton = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const url = urlInput.value.trim();
            if (!url) return;

            // Show loading state
            loadingDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            submitButton.disabled = true;

            try {
                const response = await fetch('/scrape', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url }),
                });

                const data = await response.json();

                if (data.error) {
                    resultDiv.className = 'error';
                    resultDiv.innerHTML = \`
                        <div class="result-title error">Error</div>
                        <div class="error-message">\${data.error}</div>
                    \`;
                } else {
                    resultDiv.className = 'success';
                    resultDiv.innerHTML = \`
                        <div class="result-title success">Station Found</div>
                        <div class="station-name">\${data.stationName}</div>
                    \`;
                }
            } catch (error) {
                resultDiv.className = 'error';
                resultDiv.innerHTML = \`
                    <div class="result-title error">Error</div>
                    <div class="error-message">Failed to fetch data: \${error.message}</div>
                \`;
            } finally {
                loadingDiv.style.display = 'none';
                submitButton.disabled = false;
            }
        });
    </script>
</body>
</html>
`;

const server = Bun.serve({
    port: 4200,
    async fetch(req) {
        const url = new URL(req.url);

        // Serve HTML form
        if (url.pathname === '/' && req.method === 'GET') {
            return new Response(HTML_FORM, {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        // Handle scrape request
        if (url.pathname === '/scrape' && req.method === 'POST') {
            try {
                const body: any = await req.json();
                const targetUrl = body.url;

                if (!targetUrl) {
                    return new Response(JSON.stringify({ error: 'URL is required' }), { 
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                console.log('Scraping URL:', targetUrl);
                const result = await scrapeStationName(targetUrl);
                console.log('Result:', result);
                
                if (result.error) {
                    return new Response(JSON.stringify({ error: result.error }), { 
                        status: 500,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }

                return new Response(JSON.stringify({ stationName: result.stationName }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.error('Server error:', error);
                return new Response(JSON.stringify({ error: String(error) }), { 
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // 404 for other routes
        return new Response('Not Found', { status: 404 });
    },
});

console.log(`🚀 Server running at http://localhost:${server.port}`);
