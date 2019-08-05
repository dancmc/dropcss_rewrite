const HTMLParser = require('node-html-parser');
const express = require('express');
const expressApp = express();
const puppeteer = require('puppeteer');
const { default:fetch,Headers} = require('node-fetch');
const dropcss = require('dropcss');
const fs = require('fs-extra');
const minify = require('html-minifier').minify;
const {List, Map} = require('immutable');
const commander = require('commander');
const devices = require('puppeteer/DeviceDescriptors');


commander
    .version('1.0.0', '-v, --version')
    .usage('[OPTIONS]...')
    .option('-n, --hostname <hostname>', 'Hostname of server for rewritten html')
    .option('-r, --root <root>', 'Root directory, MUST be supercache folder')
    .option('-s, --sitelist <sitelist>', "Path to sitelist.txt")
    .option('-p, --password', "Page is password protected")
    .parse(process.argv);

console.log(commander.hostname);
console.log(commander.root);

if (!commander.hostname || !commander.root || !commander.sitelist || !commander.root.endsWith("supercache")) {
    commander.help();
}


let auth = commander.password;


const hostname = commander.hostname;

class PromiseQueue {
    constructor() {
        this.queue = List([]);
        this.idle = true;
    }

    addPromise(fn, ...params) {
        this.queue = this.queue.push({fn, params});

        if (this.idle) {
            this.executePromise();
        }
    }

    executePromise() {
        if (this.queue.size > 0) {

            this.idle = false;
            let p = this.queue.first();

            this.queue = this.queue.shift();
            p.fn(...p.params).then(() => {
                this.idle = true;
                this.executePromise();
            });
        }
    }
}


(async () => {

    const promiseQueue = new PromiseQueue();
    let notices = List([]);
    let browser = null;


    async function startBrowser() {
        if (browser === null) {
            let args = [];
            args.push(`--window-size=425,500`);
            browser = await puppeteer.launch({headless: true});
            let pages = await browser.pages();
            const numberOfOpenPages = pages.length;
            console.log("Pages : " + numberOfOpenPages);
            console.log("Title : " + await pages[0].title());
            if (numberOfOpenPages === 1) {
                await pages[0].close();
            }
        }
    }

    setInterval(async () => {
        if (browser !== null) {
            let pages = await browser.pages();
            const numberOfOpenPages = pages.length;
            if (numberOfOpenPages === 0) {
                console.log("Closing Browser");
                await browser.close();
                browser = null;
            }
        }
    }, 120000);


// -- SERVER AND PROCESS STUFF --


    const port = 9999;
    expressApp.get("/kill", (request, response) => {
        response.send('Killing\n');

        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 100)

    });

    expressApp.get("/forceupdate", (request, response) => {
        response.send('Updating....\n');

        updateCacheFromSiteList(true);

    });
    const server = expressApp.listen(port, (err) => {
        if (err) {
            return console.log('something bad happened', err)
        }
        console.log(`server is listening on ${port}`)
    });

// kill entire app when SIGTERM received  
    process.on('SIGTERM', () => {
        server.close(() => {
            console.log('Server terminated')
        });
        foldersWatched.map((v, k) => {
            v.close();
        });
        if (browser !== null) {
            browser.close().then(() => {
                console.log("Browser Closed");
                process.exit();
            });
        }
    });

// -- HTML AND CSS REWRITING STUFF -- 

    let foldersWatched = Map({});

    function rewriteHtmlFile(file) {

        if (!file.endsWith("html")) {
            return
        }

        // check if file has already been rewritten
        console.log("Starting to rewrite " + file);


        let marked = false;
        try {
            let data = fs.readFileSync(file, 'utf8');
            let root = HTMLParser.parse(data);
            marked = root.querySelector("head").querySelector("dropcss");
        } catch (e) {

        }
        if (!marked) {
            console.log("rewriteHtmlFile : Not marked, processing " + file);
            // derive url from filepath
            let url = urlFromPath(file);
            if (!url) {
                console.log("rewriteHtmlFile : Error getting url, ended");
                return;
            }
            // rewrite both mobile and desktop
            let mobileFile = "";
            let desktopFile = "";
            if(file.includes("index-https-mobile")){
                mobileFile = file;
                desktopFile = file.replace("index-https-mobile", "index-https-desktop");
            }
            if(file.includes("index-https-desktop")){
                mobileFile = file.replace("index-https-desktop", "index-https-mobile");
                desktopFile = file;
            }
            promiseQueue.addPromise(processCssHtml, url, mobileFile);
            promiseQueue.addPromise(processCssHtml, url, desktopFile);

            console.log("rewriteHtmlFile : Queued " + file);
        } else {
            console.log("rewriteHtmlFile : Error, file has already been rewritten")
        }
    }


    function urlFromPath(file) {
        if (!file.endsWith("index-https-desktop.html") && !file.endsWith("index-https-mobile.html")) {
            console.log("urlFromPath : Error, not index html file");
            return;
        }
        let splitPath = file.split("supercache/");
        if (splitPath.length !== 2) {
            console.log("urlFromPath : Error, not in supercache");
            return;
        }
        let routeParts = splitPath[1].split("/");
        if (!hostname.includes(routeParts[0])) {
            console.log("urlFromPath : Error, route does not match host domain");
            return;
        }
        routeParts.pop(); // remove the index-https.html bit
        return "https://" + routeParts.join("/");
    }


    async function processCssHtml(url, fileToReplace) {
        console.log("processCssHtml : " + url + " " + fileToReplace);



        // check if this is a forms page (should not be indexed)
        let isForm = false;
        notices.forEach(n=>{

           if(n.category==="forms" && n.url===(url+"/")){
               isForm = true;
               console.log("ISFORM")
           }
        });

        await startBrowser();
        const page = await browser.newPage();

        if(fileToReplace.includes("index-https-mobile")){
            const iPhone = devices['iPhone 6'];
            await page.emulate(iPhone);
        }
        // await page.setViewport({
        //     width: 425,
        //     height: 500,
        //     deviceScaleFactor: 1,
        //   });
        if (auth) {
            console.log("Waiting for auth");
            await page.authenticate({username: "admin", password: "admin"});
        }
        await page.setDefaultNavigationTimeout(10000);

        let response;
        try {
            response = await page.goto(url);
        } catch (e) {
            console.log(url + "  " + e);
            await page.close();
            return;
        }
        if (response.status() !== 200) {
            console.log("dropCss : Page returned bad code, " + response.status());
            await page.close();
            return;
        }
        const originalHtml = await response.text();
        const finalisedHtml = await page.content();
        // const styleHrefs = await page.$$eval('link[rel=stylesheet]', els => Array.from(els).map(s => s.href));

        const finalisedRoot = HTMLParser.parse(finalisedHtml, {script: true, style: true, pre: true});
        try {
            let dc = finalisedRoot.querySelector("head").querySelector("dropcss") || finalisedRoot.querySelector("body").querySelector("dropcss");
            if (dc) {
                console.log("dropCss : Server Html is already dropcssed");
                await page.close();
                return;
            }
        } catch (e) {
            console.log("error reading final html")
        }

        const styleHrefs = [];
        let finalCss = [];
        finalisedRoot.querySelector("head").childNodes.forEach(s => {
            if (/rel=["|']stylesheet["|']/.test(s.rawAttrs) && !s.rawAttrs.includes("font")) {
                styleHrefs.push(s.attributes.href);
            } else if (s.tagName === 'style') {
                styleHrefs.push(s.rawText);
            }
        });

        // make sure async promises are added to cleaned css array in original order of stylesheets
        // otherwise css will be out of order and cause issues

        await Promise.all(styleHrefs.map(async href => {

                // hack to maintain order of styles in head
                if (!href.startsWith("http")) {
                    return href;
                }

                let response = await fetch(href);
                let css = await response.text();
                console.log("GotCSS");

                let start = +new Date();

                let clean = dropcss({
                    css,
                    html: finalisedHtml, // ......... remember that when passing object param without explicit key, the variable name becomes the key, so not putting html: will cause dropcss library to throw a fit
                });

                // console.log({
                //     stylesheet: href,
                //     cleanCss: clean.css,
                //     elapsed: +new Date() - start,
                // });
                console.log("Stylesheet in original html : " + href);

                return clean.css;
            }
        )).then(css => finalCss = css);


        // write to css file
        // but no point cos just inline everything if can't extract just critical portion
        // fs.writeFile("/users/daniel/downloads/finalcss.css", finalCss, function(err) {
        //     if(err) {
        //         return console.log(err);
        //     }
        //     console.log("The file was saved!");
        // });

        // GET HTML
        let root = HTMLParser.parse(originalHtml, {script: true, style: true, pre: true}); // parse html from original (pre-evaluated) html file
        // actually is bad idea to use the puppeteer provided html, cos that is after javascript acts on it

        // EXTRACT NON-CSS TAGS FROM HEAD
        // extract tags that are not stylesheets, or are fonts, and convert all to string
        let filteredHeadString = "";

        // if forms page, prevent from being indexed
        if(isForm){
            filteredHeadString+='<meta name="robots" content="noindex">';
        }

        root.querySelector("head").childNodes.forEach(c => {

            if (!c.tagName /* for text nodes */ || (c.tagName !== 'style' && !/rel=["|']stylesheet["|']/.test(c.rawAttrs)) || c.rawAttrs.includes("font")) {
                filteredHeadString += c.toString();
            }

        });


        // INLINE CSS BACK INTO HEAD AND ALSO PRELOAD FONTS CALLED IN CSS
        // get font urls from css
        let fontUrls = [];
        let fontRegex = (/url\([^)]+\.woff2/g); // match regex within css
        finalCss.forEach(css => {
            let fontRegexMatches = css.match(fontRegex);
            if (fontRegexMatches !== null) {
                fontUrls.push("https:" + fontRegexMatches[0].replace("url(", "")); // add matched font url to list
            }
        });

        // add push hints to head
        fontUrls.forEach(f => {
            filteredHeadString += '<link rel="preload" as="font" href="' + f + '" type="font/woff2" crossorigin="anonymous"/>';
        });

        // add placeholder tags for each css block you want to inline
        // because dropcss somehow makes style tags blank
        finalCss.forEach(_ => {
            console.log("inline");
            filteredHeadString += "<holder></holder>"
        });

        // add dropcss tag to indicate has been processed
        filteredHeadString += "<dropcss></dropcss>";

        // set head to old content minus css plus placeholder tags
        root.querySelector("head").set_content(filteredHeadString);

        // if this is notices page, generate relevant lists and insert in root
        if(fileToReplace.includes("/notices/")){
            await insertNoticesHtml(root);
        }

        // convert entire root to string then replace placeholder tags with inlined cleaned css
        let htmlRootString = root.toString();
        finalCss.forEach(css => {
            htmlRootString = htmlRootString.replace("<holder></holder>", "<style>" + css + "</style>\n");
        });
        htmlRootString = minify(htmlRootString, {});

        // !!!!!!! not putting doctype will cause some browsers to handle styles incorrectly
        htmlRootString = "<!DOCTYPE html>\n" + htmlRootString;
        fs.writeFile(fileToReplace, htmlRootString, () => {
        });
        console.log("dropCss : rewrote " + fileToReplace);

        try {
            await page.goto('about:blank');
        } catch (e) {
            console.log("Tried to navigate to blank");
        } finally {
            await page.close();
            console.log("CLOSING PAGE");
        }


    }

    async function insertNoticesHtml(dom) {
        // notice list should have title of post plus link
        let noticesHtml = `
            <h5>Notices/Announcements</h5>
            <ul>
                ${generateNoticeListHtml()}
            </ul>    
        `;

        // holiday list should have title of post plus link
        let holidayList = notices.filter(o=> o.category.toLowerCase() === "holiday-programs");
        let holidayProgramsHtml = `
             <h5>Holiday Programs</h5>
             <ul>
                ${generateHolidayListHtml()}
             </ul>    
        `;

        // forms list should have title of form plus link
        let formList = notices.filter(o=> o.category.toLowerCase() === "forms");
        let formsHtml = `
             <h5>Forms</h5>
             <ul>
                ${await generateFormListHtml()}
             </ul>    
        `;

        let totalHtml =  noticesHtml+holidayProgramsHtml+formsHtml;

        dom.querySelectorAll("h5").forEach(h=>{
            if(h.rawText.toLowerCase().startsWith("recent")){
                h.parentNode.set_content(totalHtml);
            }
        })
    }

    function generateNoticeListHtml(){
        let html = "";
        notices
            .filter(o=> o.category.toLowerCase() === "notices")
            .forEach(o=>{
               html+=`<li><a href="${o.url}">${o.title}</a></li>`
            });
        return html;
    }

    function generateHolidayListHtml(){
        let html = "";
        notices
            .filter(o=> o.category.toLowerCase() === "holiday-programs")
            .forEach(o=>{
                html+=`<li><a href="${o.url}">${o.title}</a></li>`
            });
        return html;
    }

    async function generateFormListHtml(){
        let html = "";
        let forms = await Promise.all(
            notices
            .filter(o=> o.category.toLowerCase() === "forms")
            .map(async o => {

                let headers = new Headers();
                headers.set('Authorization', 'Basic ' + Buffer.from("admin:admin").toString('base64'));
                let response = await fetch(o.url,{headers});
                let html = await response.text();
                const root = HTMLParser.parse(html, {script: true, style: true, pre: true});
                try {
                    let fileBlock = root.querySelector(".wp-block-file");
                    let aBlock = fileBlock.querySelector("a");

                    return {title:aBlock.rawText, url:aBlock.attributes["href"]};
                }catch(e){
                    return {title: "", url: ""};
                }
            }
        ));
        forms.forEach(f=>{
           if(f.title){
               html+=`<li><a href="${f.url}">${f.title}</a></li>`
           }
        });
        return html;
    }


// Set root dir to watch (supercache)
    function watchRootDir(rootDir) {

        if (!fs.existsSync(rootDir)) {
            fs.mkdirSync(rootDir, {recursive: true});
        }

        // watch the root dir for sub directory changes only
        let rootWatcher = fs.watch(rootDir, {persistent: true, encoding: 'utf8'}, function (ev, file) {
            if (ev === 'rename') {
                console.log("watchRootDir : " + file);
                setTimeout(() => {
                    let filepath = rootDir + "/" + file;
                    if (fs.existsSync(filepath) && fs.lstatSync(filepath).isDirectory()) {
                        recursiveWatchAndCss(filepath);
                    }
                }, 1000);
            }
        });
        foldersWatched = foldersWatched.set(rootDir, rootWatcher);
        console.log("Root dir watcher set");

        // kick start process by running css function on all existing cached routes
        fs.readdirSync(rootDir, {encoding: 'utf8', withFileTypes: true}).forEach(f => {
            if (f.isDirectory()) {
                console.log("subdir found " + f.name);
                recursiveWatchAndCss(rootDir + "/" + f.name);
            }
        });
    }


// recursively set a watch on each folder, and also run the dropcss function for that folder/route
    function recursiveWatchAndCss(folder) {

        // but dropcss function MUST check for whether changed index file was result of dropcss
        // otherwise end up in infinite loop

        // do BFS, for each folder edit html/css first then set watch with condition
        let filesToProcess = List([folder]);
        while (filesToProcess.size > 0) {
            let f = filesToProcess.first();
            filesToProcess = filesToProcess.shift();
            if (fs.lstatSync(f).isDirectory()) {
                if (foldersWatched.has(f)) {
                    console.log("recursiveWatchAndCss : already watching folder " + f);
                } else {
                    console.log("reading dir " + f);
                    // process each of the folder's contents
                    // add subdirs to processing queue
                    fs.readdirSync(f, {encoding: 'utf8', withFileTypes: true}).forEach(child => {
                        let childpath = f + "/" + child.name;
                        if (child.isDirectory()) {
                            console.log("adding subdir " + childpath);
                            filesToProcess = filesToProcess.push(childpath);
                        }
                    });
                    // rewrite html files (desktop or mobile will trigger rewriting of both)
                    rewriteHtmlFile(f + "/" + "index-https-desktop.html");
                    let watcher = fs.watch(f, {persistent: true, encoding: 'utf8'}, function (ev, file) {
                        changeDetected(ev, f + "/" + file);
                    });
                    foldersWatched = foldersWatched.set(f, watcher);
                }
            }
        }
    }

// when a file change is detected
    function changeDetected(ev, file) {
        setTimeout(() => {

            let isDirectory = false;
            try {
                isDirectory = fs.lstatSync(file).isDirectory();
            } catch (e) {

            }
            if (ev === 'rename' && isDirectory) {
                // if folder created, set watch and run dropcss function for that folder
                if (!fs.existsSync(file)) {
                    console.log("changeDetected : " + file + " does not exist");
                    return;
                }
                recursiveWatchAndCss(file);
            } else if (!isDirectory) {
                // if file created/changed, run dropcss function for this file
                rewriteHtmlFile(file);
            }
        }, 1000);

    }


    initialiseSiteList();

    /*
        1. On first program run, delete everything and start over, don't know what is out of date :
            2. Check sitelist
            3. Delete any changed files fn2
            4. Create any other non-existent cache folders fn2
            5. Set a watch on sitelist file
                6. if changes and exists,
                7. Delete any changed files fn2
                8. Create any other non-existent cache folders fn2


     */
    function initialiseSiteList() {
        if (!fs.existsSync(commander.sitelist)) {
            console.log("checkSiteList : Site list does not exist");
            return;
        }
        let rootDir = commander.root;
        if (!fs.existsSync(rootDir)) {
            fs.mkdirSync(rootDir, {recursive: true});
        }

        // empty the cache root
        fs.readdirSync(rootDir, {encoding: 'utf8', withFileTypes: true}).forEach(f => {
            let path = rootDir + "/" + f.name;
            fs.removeSync(path);
            console.log("Scrubbed " + path);
        });

        updateCacheFromSiteList();

        fs.watch(commander.sitelist, {persistent: true, encoding: 'utf8'}, _ => {
            setTimeout(() => updateCacheFromSiteList(), 1500);
        });

        watchRootDir(commander.root);
    }

    function updateCacheFromSiteList(force=false) {
        if (!fs.existsSync(commander.sitelist)) {
            console.log("updateCacheFromSiteList : Site list does not exist");
            return;
        }

        // read urls/change booleans
        let data = fs.readFileSync(commander.sitelist, 'utf8');
        let jsonArray = JSON.parse(data);
        // reset notice list
        notices = List([]);

        // add all posts to notices list
        notices = notices.push(...jsonArray.filter(o => o.type === "post"));

        jsonArray.forEach(o => {
            let url = o.url;
            // should always mark notices page for rewrite
            let changed = o.edited || url.endsWith("/notices") || force;

            if (!url) {
                return;
            }

            console.log("updateCacheFromSiteList : " + JSON.stringify(o));

            let folderpath = commander.root + "/" + url.replace("https://", "");
            let filepathDesktop = folderpath + "/index-https-desktop.html";
            let filepathMobile = folderpath + "/index-https-mobile.html";

            // if url changed, try to delete file
            if (changed) {
                if (fs.existsSync(filepathDesktop)) {
                    fs.removeSync(filepathDesktop);
                }
                if (fs.existsSync(filepathMobile)) {
                    fs.removeSync(filepathMobile);
                }
            }
            // otherwise try to create folder
            if (!fs.existsSync(folderpath)) {
                fs.mkdirSync(folderpath, {recursive: true});
            }

        });


    }

    setInterval(() => updateCacheFromSiteList(), 3600000);


})();

