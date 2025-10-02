import { Builder, Browser, By, WebDriver, until } from 'selenium-webdriver';
import { Options as ChromeOptions, ServiceBuilder } from 'selenium-webdriver/chrome';

const CHROMEDRIVER_PATH = process.env.CHROMEDRIVER_PATH || "/usr/bin/chromedriver";


async function scrapeRatbvPage(): Promise<void> {
    const chromeOptions = new ChromeOptions();
    chromeOptions.addArguments('--headless', '--no-sandbox', '--disable-dev-shm-usage');
    const service = new ServiceBuilder(CHROMEDRIVER_PATH);
    const driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(chromeOptions)
        .setChromeService(service)
        .build();

    try {
        await driver.get('https://www.ratbv.ro/afisaje/23b-dus.html');

        // Get linia_web from frame 2 (MainFrame)
        await driver.switchTo().frame(2);
        const linie = await driver.findElement(By.id("linia_web")).findElement(By.tagName("b")).getText();
        console.log('Line:', linie);

        // Switch back to main content then to frame 1 for station list
        await driver.switchTo().defaultContent();
        await driver.switchTo().frame(1);

        // Get all station elements (both list_sus_active and list_statie)
        const stationElements = await driver.findElements(By.css('.list_sus_active, .list_statie'));

        const stations = [];

        // Loop through each station and extract the name and link
        for (const station of stationElements) {
            const boldElement = await station.findElement(By.tagName('b'));
            const stationName = await boldElement.getText();
            const id = await station.getAttribute('id');

            // Get the <a> tag and extract the href
            const linkElement = await station.findElement(By.tagName('a'));
            const href = await linkElement.getAttribute('href');

            const stationLinkName = stationName.toLowerCase().replace(/\./g, '').replace(/\s+/g, '-');
            const stationData = { route: stationLinkName, name: stationName, link: href };
            
            stations.push(stationData);

        }

        console.log('\nAll stations:', JSON.stringify(stations, null, 2));

    } catch (error) {
        console.error('Error scraping page:', error);
    } finally {
        await driver.quit();
    }
}

// Call the function
scrapeRatbvPage();
