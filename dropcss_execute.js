const HTMLParser = require('node-html-parser');
const express = require('express');
const expressApp = express();
const puppeteer = require('puppeteer');
const fetch = require('node-fetch');
const dropcss = require('dropcss');
const fs = require('fs');
const minify = require('html-minifier').minify;
const { List,Map } = require('immutable');
const commander = require('commander');


commander
  .version('1.0.0', '-v, --version')
  .usage('[OPTIONS]...')
  .option('-n, --hostname <hostname>', 'Hostname of server for rewritten html')
  .option('-r, --root <root>', 'Root directory')
  .option('-s, --sitelist <sitelist>',"Path to sitelist.txt")
  .option('-p, --password', "Page is password protected")
  .parse(process.argv);

  console.log(commander.hostname);
  console.log(commander.root);

if(!commander.hostname || !commander.root || !commander.sitelist){
    commander.help();
}

let auth = commander.password;


const hostname = commander.hostname;

class PromiseQueue{
    constructor(){
        this.queue = List([]);
        this.idle = true;
    }

    addPromise(fn, ...params){
        this.queue = this.queue.push({fn,params});

        if(this.idle){
            this.executePromise();
        }
    }

    executePromise(){
        if(this.queue.size>0){
            
            this.idle = false;
            let p = this.queue.first();
            
            this.queue = this.queue.shift();
            p.fn(...p.params).then(()=>{
                this.idle = true;
                this.executePromise();
            });
        }
    }
}


(async ()=>{

const promiseQueue = new PromiseQueue();
let browser = null;


async function startBrowser(){
    if(browser===null){
        browser = await puppeteer.launch({headless: true});
        let pages = await browser.pages();
        const numberOfOpenPages = pages.length;
        console.log("Pages : "+numberOfOpenPages);
        console.log("Title : "+ await pages[0].title());
        if(numberOfOpenPages===1){
            await pages[0].close();
        }
    }
}

setInterval(async ()=>{
    if(browser!==null){
        let pages = await browser.pages();
        const numberOfOpenPages = pages.length;
        if(numberOfOpenPages===0){
            console.log("Closing Browser");
            await browser.close();
            browser = null;
        }
    }
},30000);


// -- SERVER AND PROCESS STUFF --


const port = 9999;
expressApp.get("/kill",(request, response) => {
    response.send('Killing\n');

    setTimeout(()=>process.kill(process.pid, 'SIGTERM'),1000)

  });
const server = expressApp.listen(port,(err) => {
    if (err) {
      return console.log('something bad happened', err)
    }
    console.log(`server is listening on ${port}`)
  });

// kill entire app when SIGTERM received  
process.on('SIGTERM', () => {
    foldersWatched.map((v,k)=>{
        v.close();
    });
  server.close(() => {
    console.log('Server terminated')
  });
  if(browser!==null){
    browser.close().then(()=>{
        console.log("Browser Closed");
        process.exit();
      });
  }
});

// -- HTML AND CSS REWRITING STUFF -- 

let foldersWatched = Map({});

function rewriteHtmlFile(file){

    if(!file.endsWith("html")){
        return
    }

    // check if file has already been rewritten
    console.log("Starting to rewrite "+file);
    
    
    let marked=false;
    try{
        let data = fs.readFileSync(file, 'utf8');
        let root =  HTMLParser.parse(data);
        marked = root.querySelector("head").querySelector("dropcss");
   }catch(e){

   }
    if(!marked){
        console.log("rewriteHtmlFile : Not marked, processing " + file);
        // derive url from filepath
        let url = urlFromPath(file);
        if(!url){
            console.log("rewriteHtmlFile : Error getting url, ended");
            return;
        }
        promiseQueue.addPromise(processCssHtml,url, file);

        console.log("rewriteHtmlFile : Processed "+file);
    }else {
        console.log("rewriteHtmlFile : Error, file has already been rewritten")
    }
}


function urlFromPath(file){
    if(!file.endsWith("index-https.html")){
        console.log("urlFromPath : Error, not index html file");
        return;
    }
    let splitPath = file.split("supercache/");
    if(splitPath.length!==2){
        console.log("urlFromPath : Error, not in supercache");
        return;
    }
    let routeParts = splitPath[1].split("/");
    if(!hostname.includes(routeParts[0])){
        console.log("urlFromPath : Error, route does not match host domain");
        return;
    }
    routeParts.pop(); // remove the index-https.html bit
    return "https://"+routeParts.join("/");
}


async function processCssHtml(url, fileToReplace) {
    console.log("processCssHtml : "+url+" "+fileToReplace);    

    await startBrowser();
    const page = await browser.newPage();
    if(auth){
        console.log("Waiting for auth");
        await page.authenticate({username:"admin", password:"admin"});
    }
    await page.setDefaultNavigationTimeout(10000); 

    let response;
    try{
        response = await page.goto(url);
    } catch(e){
        console.log(url + "  "+e);
        await page.close();
        return;
    }
    if(response.status()!==200){
        console.log("dropCss : Page returned bad code, "+response.status());
        await page.close();
        return;
    }
    const originalHtml = await response.text();
    const finalisedHtml = await page.content();
    // const styleHrefs = await page.$$eval('link[rel=stylesheet]', els => Array.from(els).map(s => s.href));
    
    const finalisedRoot = HTMLParser.parse(finalisedHtml, {script:true, style:true, pre:true});
    try{
            let dc = finalisedRoot.querySelector("head").querySelector("dropcss") || finalisedRoot.querySelector("body").querySelector("dropcss");
            if(dc){
                console.log("dropCss : Server Html is already dropcssed");
                await page.close();
                return;
            }
        }catch(e){
            console.log("error reading final html")
        }

    const styleHrefs = [];
    let finalCss = [];
    finalisedRoot.querySelector("head").childNodes.forEach(s=>{
        if( /rel=["|']stylesheet["|']/.test(s.rawAttrs) && !s.rawAttrs.includes("font")){
        styleHrefs.push(s.attributes.href);
        }else if (s.tagName === 'style'){
            finalCss.push(s.rawText);
        }
    });

    
    await Promise.all(styleHrefs.map(href =>
        fetch(href).then(r => r.text()).then(css => {
            let start = +new Date();

            let clean = dropcss({
                css,
                html : finalisedHtml, // ......... remember that when passing object param without explicit key, the variable name becomes the key, so not putting html: will cause dropcss library to throw a fit
            });

            // console.log({
            //     stylesheet: href,
            //     cleanCss: clean.css,
            //     elapsed: +new Date() - start,
            // });
            console.log("Stylesheet in original html : "+href);
            finalCss.push(clean.css)
            
        })
    ));

    

    // write to css file
    // but no point cos just inline everything if can't extract just critical portion
    // fs.writeFile("/users/daniel/downloads/finalcss.css", finalCss, function(err) {
    //     if(err) {
    //         return console.log(err);
    //     }
    //     console.log("The file was saved!");
    // }); 

    // GET HTML
    let root = HTMLParser.parse(originalHtml, {script:true, style:true, pre:true}); // parse html from original (pre-evaluated) html file
    // actually is bad idea to use the puppeteer provided html, cos that is after javascript acts on it

    // EXTRACT NON-CSS TAGS FROM HEAD
    // extract tags that are not stylesheets, or are fonts, and convert all to string
    let filteredHeadString = "";
    root.querySelector("head").childNodes.forEach(c=>{
        
        if(!c.tagName /* for text nodes */ || (c.tagName !== 'style' && !/rel=["|']stylesheet["|']/.test(c.rawAttrs)) || c.rawAttrs.includes("font")){
            filteredHeadString+=c.toString();
        }
        
    });
    
    
    // INLINE CSS BACK INTO HEAD AND ALSO PRELOAD FONTS CALLED IN CSS
    // get font urls from css
    let fontUrls = [];
    let fontRegex = (/url\([^)]+\.woff2/g); // match regex within css
    finalCss.forEach(css=>{
        let fontRegexMatches = css.match(fontRegex);
        if(fontRegexMatches!==null){
            fontUrls.push("https:"+fontRegexMatches[0].replace("url(","")); // add matched font url to list
        }
    });

    // add push hints to head
    fontUrls.forEach(f=>{
        filteredHeadString+='<link rel="preload" as="font" href="'+f+'" type="font/woff2" crossorigin="anonymous"/>';
    });

    // add placeholder tags for each css block you want to inline
    // because dropcss somehow makes style tags blank
    finalCss.forEach(_=>{
        console.log("inline");
        filteredHeadString+="<holder></holder>"
    });

    // add dropcss tag to indicate has been processed
    filteredHeadString+="<dropcss></dropcss>";

    // set head to old content minus css plus placeholder tags
    root.querySelector("head").set_content(filteredHeadString);
    // convert entire root to string then replace placeholder tags with inlined cleaned css
    let htmlRootString = root.toString();
    finalCss.forEach(css=>{
    htmlRootString = htmlRootString.replace("<holder></holder>", "<style>"+css+"</style>\n");
    });
    htmlRootString = minify(htmlRootString, {});
    
    // !!!!!!! not putting doctype will cause some browsers to handle styles incorrectly
    htmlRootString = "<!DOCTYPE html>\n"+ htmlRootString;
    fs.writeFile(fileToReplace, htmlRootString, () =>{});
    console.log("dropCss : rewrote "+fileToReplace);

    try{
        await page.goto('about:blank');
    }catch(e){
        console.log("Tried to navigate to blank");
    }finally{
        await page.close();
        console.log("CLOSING PAGE");
    }
    
    
}



// Set root dir to watch (supercache)
function watchRootDir(rootDir){

    if(!fs.existsSync(rootDir)){
        fs.mkdirSync(rootDir,{recursive:true});
    }

    // watch the root dir for sub directory changes only
    let rootWatcher = fs.watch(rootDir,{persistent:true, encoding:'utf8'}, function(ev, file){
        if(ev==='rename'){
            console.log("watchRootDir : "+file);
            setTimeout(()=>{
                let filepath = rootDir+"/"+file;
                if(fs.existsSync(filepath) && fs.lstatSync(filepath).isDirectory()){
                    recursiveWatchAndCss(filepath);
                }
            },1000);
        }
    });
    foldersWatched = foldersWatched.set(rootDir,rootWatcher);
    console.log("Root dir watcher set");

    // kick start process by running css function on all existing cached routes
    fs.readdirSync(rootDir,{encoding:'utf8', withFileTypes:true}).forEach(f=>{
        if(f.isDirectory()){
            console.log("subdir found "+f.name);
            recursiveWatchAndCss(rootDir+"/"+f.name);
        }
    });
}


// recursively set a watch on each folder, and also run the dropcss function for that folder/route
function recursiveWatchAndCss(folder){
    
    // but dropcss function MUST check for whether changed index file was result of dropcss
    // otherwise end up in infinite loop

    // do BFS, for each folder edit html/css first then set watch with condition
    let filesToProcess = List([folder]);
    while(filesToProcess.size>0){
        let f = filesToProcess.first();
        filesToProcess = filesToProcess.shift();
        if(fs.lstatSync(f).isDirectory()){
            if(foldersWatched.has(f)){
                console.log("recursiveWatchAndCss : already watching folder "+f);
            }else{
                console.log("reading dir "+f);
                // process each of the folder's contents
                fs.readdirSync(f,{encoding:'utf8', withFileTypes:true}).forEach(child=>{
                    let childpath = f+"/"+child.name;
                    if(child.isDirectory()){
                        console.log("adding subdir "+childpath);
                        filesToProcess = filesToProcess.push(childpath);
                    }
                });
                rewriteHtmlFile(f+"/"+"index-https.html");
                let watcher = fs.watch(f,{persistent:true, encoding:'utf8'}, function(ev, file){
                    changeDetected(ev,f+"/"+file);
                });
                foldersWatched = foldersWatched.set(f, watcher);
            }
        }
    }
}

// when a file change is detected
function changeDetected(ev, file){
    setTimeout(()=>{
        
        let isDirectory = false;
        try{
            isDirectory = fs.lstatSync(file).isDirectory();
        }catch(e){

        }
        if(ev==='rename' && isDirectory){
            // if folder created, set watch and run dropcss function for that folder
            if(!fs.existsSync(file)){
                console.log("changeDetected : "+file+" does not exist");
                return;
            }
            recursiveWatchAndCss(file);
        } else if (!isDirectory) {
            // if file created/changed, run dropcss function for this file
            rewriteHtmlFile(file);
        }
    },1000);
    
}


watchRootDir(commander.root);

function checkSiteList(){
    let data = fs.readFileSync(commander.sitelist, 'utf8');
    let urls = data.trim().split("\n");
    urls.forEach(u=>{
        let folderpath = commander.root+"/"+u.replace("https://", "");
        if(!fs.existsSync(folderpath)){
            fs.mkdirSync(folderpath,{recursive:true});
        }
        console.log("CHECKSITELIST : "+u);
        // recursiveWatchAndCss(folderpath);
    });
    setTimeout(()=>checkSiteList(), 1800000)
}

setTimeout(()=>checkSiteList(), 5000);


})();

