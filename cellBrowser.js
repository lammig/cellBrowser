// A viewer for (x,y) scatter plots 
// shows associated meta data (usually key->val attributes, one mapping per circle) 
// and expression data (string -> float, one mapping per circle)

/* jshint -W097 */
"use strict";

var tsnePlot = function() {
    var gCurrentDataset = null; // object with these fields
    // configuration provided by user:
    // - .baseUrl (reqd) = URL where files are loaded from
    // - .shortLabel (reqd) = label for the dataset shown
    // - .clusterField = field name to color on
    // - .labelField  = field name to use as cluster labels
    // - .coordFiles: optional, list of dicts, with at least shortLabel and url attributes
    // - .coordIdx: optional, current index of layout shown
    // - .metaColors: dict of metaValue -> hexcolor (six chars)
    // - .hubUrl: url of hub.txt, with UCSC track hub of reads
    // not necessary at all:
    // - .showLabels: optional, bool, whether cluster labels are shown
    // - .markers: optional, list of (subdirectory, label). 
    //            Subdir contains one .tsv per cluster, shown on click on cluster label.
    
    // added by code upon load:
    // - .matrixOffsets: gene symbol -> [offset, linelen]
    // - .matrixCellIds: array of cellIds, read from header line of matrix
    // - .singleExpr: currently selected gene expression vector from combobox
    //      .symbol = current gene symbol 
    //      .values = dict cellId -> value
    // - .metaFields = array of meta field labels
    // - .metaData   = dict cellId -> array of meta fields (strings)
    // - .preloadExpr  = preloaded genes (bottom of screen), object
    //     .genes  = array of [geneSym, geneDesc, geneId (e.g. Ensembl)]
    //     .cellExpr   = dict of cellId -> array of floats, one per gene
    //     .deciles = dict of geneId -> array of 11 floats, the decile-bin edges
    // current zoom range: currently displayed min/max range of allCoords
    // - zoomRange = null;   // dict of minX, maxX, minY, maxY -> float
    // - zoomFullRange = null; // range to show 100%
    //

    var gOptions = null; // the whole object given to the loadData function, a list of dataset objects

    //var pcaCoords = null;   // array of [cellId, coord1, coord2, coord3, ... All coords are floats.

    var gCurrentCoordName = null; // currently shown coordinates

    // The current data model is not optimal and will need to be refactored one day.
    // Currently, meta data is stored in the gCurrentDataset as a object with sampleId -> array
    // Coordinates are stored in allCords as an array (x, y, sampleId), without any quad tree-like index.
    // meta data should probably be ref'ed directly from the pixi objects
    // pixelCoords should probably not exist at all, as it duplicates the pixi objects.
    // zooming is currently very slow, because of the lack of index
    // selection is very slow, because I haven't found the right pixi helper function yet to find "overlaped by rect"
    var allCoords = null;     // raw coords as read from file as a list [cellId, x, y]. x/y are floats.
    var shownCoords = null;   // currently shown float coords of allCoords. Hidden cells are not included here.
    var pixelCoords = null;   // array of [cellId, x, y] with x and y being integers on the screen

    var gDecileColors = null; // global to avoid recalculting a palette of 10 colors

    //var gLabelMetaIdx = null; // meta field to use for labels, default is no label

    var gClusterMids = null; // array of (clusterLabel, x, y), recalculated if null

    // only temporarily used to store data while it is loaded in parallel ajax requests
    var gLoad_geneList = []; // list of genes that were pasted into the gene box
    var gLoad_geneExpr = {}; // map of geneSymbol -> [geneId, array of floats with expression vectors, deciles of float array]

    // object with all information needed to map to the legend colors
    var gLegend = null;
    // all info about the current legend. gLegend.rows is:
    // [ colorHexStr, defaultColorHexStr, label, count, internalKey, uniqueKey ]
    // internalKey can be int or str, depending on current coloring mode. 
    // E.g. in meta coloring, it's the metadata string value.
    // When doing expression coloring, it's the expression bin index.
    // uniqueKey is used to save manually defined colors to localStorage

    // mapping from dots to legend entries (and therefore colors)
    // dict with cellId -> index of legend in gLegend.rows or -1 if cell is hidden
    var gClasses = null; 

    // An object of cellIds that are highlighted/selected, cellId -> true
    var gSelCellIds = {};

    // the list of cellIds currently used for gene bar coloring
    var gGeneBarCells = null;

    var renderer = null; // the PIXI canvas renderer
    var stage = null; // the PIXI stage
    var gWinInfo = null; // .width and .height of the PIXI canvas

    // mouse drag is modal: can be "select", "move" or "zoom"
    var dragMode = "zoom";
     
    // for zooming and panning
    var mouseDownX = null;
    var mouseDownY = null;

    // to detect if user just clicked on a dot
    var dotClickX = null;
    var dotClickY = null;

    // for panning
    var lastPanX = null;
    var lastPanY = null;
    var visibleGlyps = [];

    // we load the marker image only once and cache the sprites for the markers
    //var gMarker = null; 
    var gMarkerSprites = new PIXI.Container(); 

    // -- CONSTANTS
    // product name = variable, management often change their minds
    var gTitle = "UCSC Cluster Browser";
    var defaultCircleSize = 4;

    // depending on the type of data, single cell or bulk RNA-seq, we call a circle a 
    // "sample" or a "cell". This will adapt help menus, menus, etc.
    var gSampleDesc = "cell";

    var coord1Idx = 1; // index of X-axis value in the tuples of allCoords
    var coord2Idx = 2; // index of Y-axis value in the tuples of allCoords

    // width of left meta bar in pixels
    var metaBarWidth = 200;
    // margin between left meta bar and drawing canvas
    var metaBarMargin = 5;
    // width of legend, pixels
    var legendBarWidth = 200;
    var legendBarMargin = 10;
    // width of the metaBar tooltip (histogram)
    var metaTipWidth = 400;
    // height of pull-down menu bar at the top, in pixels
    var menuBarHeight = null; // defined at runtime by div.height
    // height of the toolbar, in pixels
    var toolBarHeight = 28;
    // position of first combobox in toolbar from left, in pixels
    var toolBarComboLeft = 140;
    var toolBarComboTop   = 2;
    var datasetComboWidth = 200;
    var layoutComboWidth = 150;

    // height of bottom gene bar
    var geneBarHeight = 100;
    var geneBarMargin = 5;
    // current transparency and circle size
    var transparency = 0.6;
    var circleSize = 4.0;
    // color for missing value when coloring by expression value
    var cNullColor = "c7c7c7";
    var cNullForeground = "#AAAAAA";

    var HIDELABELSNAME = "Hide cluster labels";
    var SHOWLABELSNAME = "Show cluster labels";
    var METABOXTITLE   = "Meta data fields";

    // histograms show only the top X values and summarize the rest into "other"
    var HISTOCOUNT = 12;
    // the sparkline is a bit shorter
    var SPARKHISTOCOUNT = 12;

    // links to various external databases
    var dbLinks = {
        "HPO" : "http://compbio.charite.de/hpoweb/showterm?gene=", // entrez ID
        "OMIM" : "https://omim.org/entry/", // OMIM ID
        "COSMIC" : "http://cancer.sanger.ac.uk/cosmic/gene/analysis?ln=", // gene symbol
        "SFARI" : "https://gene.sfari.org/database/human-gene/", // gene symbol
        "BrainSpLMD" : "http://www.brainspan.org/lcm/search?exact_match=true&search_type=gene&search_term=", // entrez
        "BrainSpMouseDev" : "http://developingmouse.brain-map.org/gene/show/", // internal Brainspan ID
        "Eurexp" : "http://www.eurexpress.org/ee/databases/assay.jsp?assayID=", // internal ID
        "LMD" : "http://www.brainspan.org/lcm/search?exact_match=true&search_type=gene&search_term=" // entrez
    }

    var DEBUG = true;

    function _dump(o) {
    /* for debugging */
        console.log(JSON.stringify(o));
    }

    function debug(msg, args) {
        if (DEBUG) {
            console.log(formatString(msg, args));
        }
    }

    function warn(msg) {
        alert(msg);
    }

    function cloneObj(d) {
    /* returns a copy of an object, wasteful */
        // see http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-deep-clone-an-object-in-javascript
        return JSON.parse(JSON.stringify(d));
    }

    function cloneArray(a) {
    /* returns a copy of an array */
        return a.slice();
    }

    function keys(o) {
    /* return all keys of object */
        var allKeys = [];
        for(var k in o) allKeys.push(k);
        return allKeys;
    }

    function capitalize(s) {
        return s[0].toUpperCase() + s.slice(1);
    }

    function cartSave(keyType, key, value, defaultValue) {
    /* save a value in localStorage. If the value is defaultValue, remove it from localStorage */
        if (value===defaultValue)
            localStorage.removeItem(keyType+"|"+key);
        else
            localStorage.setItem(keyType+"|"+key, value);
    }

    function cartGet(keyType, key, value, defaultValue) {
    /* get a value from localStorage or a default */
        var val = localStorage.getItem(keyType+"|"+key);
        if (val===null && defaultValue!==undefined)
            val = defaultValue;
        return val
    }

    function formatString (str) {
    /* Stackoverflow code https://stackoverflow.com/a/18234317/233871 */
    /* "a{0}bcd{1}ef".formatUnicorn("foo", "bar"); // yields "aFOObcdBARef" */
        if (arguments.length) {
            var t = typeof arguments[0];
            var key;
            var args = ("string" === t || "number" === t) ?
                Array.prototype.slice.call(arguments)
                : arguments[0];

            for (key in args) {
                str = str.replace(new RegExp("\\{" + key + "\\}", "gi"), args[key]);
            }
        }
        return str;
    }

    function copyToClipboard(element) {
    /* https://stackoverflow.com/questions/22581345/click-button-copy-to-clipboard-using-jquery */
        var $temp = $("<input>");
        $("body").append($temp);
        $temp.val($(element).text()).select();
        document.execCommand("copy");
        $temp.remove();
    }

    function iWantHue(n) {
        /* a palette as downloaded from iwanthue.com - not sure if this is better. Ellen likes it */
        var colList = ["7e4401", "244acd", "afc300", "a144cb", "00a13e",
            "f064e5", "478700", "727eff", "9ed671", "b6006c", "5fdd90", "f8384b",
            "00b199", "bb000f", "0052a3", "fcba56", "005989", "c57000", "7a3a78",
            "ccca76", "ff6591", "265e1c", "ff726c", "7b8550", "923223", "9a7e00",
            "ffa9ad", "5f5300", "ff9d76", "b3885f"]; 
        var colList2 = ["cd6a00", "843dc3", "c9cd31", "eda3ff", "854350"];
        if (n<=5)
            colList = colList2;
        return colList.slice(0, n);
    }

    function activateTooltip(selector) {
        // noconflict in html, I had to rename BS's tooltip to avoid overwrite by jquery 
        var ttOpt = {"html": true, "animation": false, "delay":{"show":400, "hide":100}, container:"body"}; 
        $(selector).bsTooltip(ttOpt);
    }

    function menuBarHide(idStr) {
    /* hide a menu bar selector */
         $(idStr).parent().addClass("disabled").css("pointer-events", "none");
    }

    function menuBarShow(idStr) {
    /* show a menu bar entry given its selector */
         $(idStr).parent().removeClass("disabled").css("pointer-events", '');
    }

    function updateToolbar() {
    /* update the toolbar with the current dataset info */
        var geneList = [];

        for(var key in gCurrentDataset.matrixOffsets) {
            geneList.push({id:key, text:key});
        }

        //$('#tpGeneCombo').select2({
            //placeholder : "Gene Symbol",
            //ajax : {},
            //dataAdapter : RefAdapter,
        //});
    }

    function updateMenu() {
    /* deactivate menu options based on current variables */
     // the "hide selected" etc menu options are only shown if some cells are selected
     if (jQuery.isEmptyObject(gSelCellIds)) {
         menuBarHide("#tpOnlySelectedButton");
         menuBarHide("#tpFilterButton");
     }
     else {
         menuBarShow("#tpOnlySelectedButton");
         menuBarShow("#tpFilterButton");
     }
     
     // the "show all" menu entry is only shown if some dots are actually hidden
     if ((pixelCoords!==null && shownCoords!==null) && pixelCoords.length===shownCoords.length)
         menuBarHide("#tpShowAllButton");
     else
         menuBarShow("#tpShowAllButton");

     $("#tpTrans"+(transparency*100)).addClass("active");
     $("#tpSize"+circleSize).addClass("active");

     // the "hide labels" menu entry is only shown if labels could be made visible
     if (gCurrentDataset.labelField === null)
         menuBarHide("#tpHideLabels");
     if (gCurrentDataset.showLabels===true)
         $("#tpHideLabels").text(HIDELABELSNAME);
     else
         $("#tpHideLabels").text(SHOWLABELSNAME);
    }

    function onOpenDatasetClick(selectedUrl) {
    /* user clicks on File - Open Dataset or on the <Info> button after the dataset */

        var winWidth = window.innerWidth - 0.05*window.innerWidth;
        var winHeight = window.innerHeight - 0.05*window.innerHeight;
        var buttonWidth = 300;
        var tabsWidth = winWidth - buttonWidth - 50;


        var htmls = [];
        var activeIdx = 0;
        htmls.push("<div class='list-group' style='width:"+buttonWidth+"px'>");
        for (var i = 0; i < gOptions.datasets.length; i++) {
            var dataset = gOptions.datasets[i];
            var line = "<button id='tpDatasetButton_"+i+"' type='button' class='list-group-item' data-datasetid='"+i+"'>"; // bootstrap seems to remove the id
            htmls.push(line);
            if (dataset.sampleCount!==undefined) {
                line = "<span class='badge'>"+dataset.sampleCount+" cells</span>";
                htmls.push(line);
            }
            htmls.push(dataset.shortLabel+"</button>");
            if (dataset.baseUrl===selectedUrl)
                activeIdx = i;
        }
        htmls.push("</div>"); // list-group

        htmls.push("<div id='tpOpenDialogLabel' style='width:"+tabsWidth+"px; position:absolute; left: 340px; top: 10px;'>");
        htmls.push("<div id='tpOpenDialogTabs'>");
        htmls.push("<ul class='nav nav-tabs'>");
        htmls.push("<li class='active'><a id='tabLink1' data-toggle='tab' href='#pane1'>Description</a></li>");
        htmls.push("<li><a id='tabLink2' data-toggle='tab' href='#pane2'>Data Processing</a></li>");
        htmls.push("</ul>");
        htmls.push("</div>");

        htmls.push("<div class='tab-content'>");

        htmls.push("<div id='pane1' class='tab-pane'>");
        htmls.push("<p>Dataset description placeholder</p>");
        htmls.push("</div>");

        htmls.push("<div id='pane2' class='tab-pane'>");
        htmls.push("<p>Dataset technical makedoc placeholder</p>");
        htmls.push("</div>");

        htmls.push("</div>"); // tab-content

        htmls.push("</div>"); // tpOpenDialogLabel

        //htmls.push("<div id='tpSelectedId' data-selectedid='0'>"); // store the currently selected datasetId in the DOM
        var selDatasetIdx = 0;

        var buttons = {
        "Cancel" :
            function() {
                $( this ).dialog( "close" );
            },
        "Open Dataset" :
            function(event) {
                loadOneDataset(selDatasetIdx);
                $( this ).dialog( "close" );
            }
        };

        showDialogBox(htmls, "Open Dataset", {width: winWidth, height:winHeight, "buttons":buttons});

        $("button.list-group-item").eq(selDatasetIdx).css("z-index", "1000"); // fix up first overlap
        $("button.list-group-item").keypress(function(e) {
            // load the current dataset when the user presses Return
            if (e.which == '13') {
                loadOneDataset(selDatasetIdx);
                $(".ui-dialog-content").dialog("close");
            }
        });

        $(".list-group-item").click( function (ev) {
            selDatasetIdx = parseInt($(event.target).data('datasetid')); // index of clicked dataset
            $(".list-group-item").removeClass("active");
            $('#tpDatasetButton_'+selDatasetIdx).bsButton("toggle"); // had to rename .button() in .html
        });

        $("#tabLink1").tab("show");

        $(".list-group-item").focus( function (event) {
            /* user selects a dataset from the list */
            //if (ev!==undefined)
                selDatasetIdx = parseInt($(event.target).data('datasetid')); // index of clicked dataset
            //else
                //selDatasetIdx = activeIdx;
            var baseUrl = gOptions.datasets[selDatasetIdx].baseUrl;
            var descUrl = joinPaths([baseUrl, "description.html"]);
            $("#pane1").load(descUrl, function( response, status, xhr ) {
                if ( status === "error" ) {
                    $( "#pane1" ).html("File "+descUrl+" was not found");
                }
                $("#tabLink1").tab("show");
            });

            var makeDocUrl = joinPaths([baseUrl, "makeDoc.html"]);
            $("#pane2").load(makeDocUrl, function( response, status, xhr ) {
                if ( status === "error" ) {
                    $( "#pane2" ).html("File "+makeDocUrl+" was not found");
                }
            });
            //$("#tpOpenDialogLabel").html(gOptions.datasets[selDatasetIdx].longLabel);
            // bootstrap has a bug where the blue selection frame is hidden by neighboring buttons
            // we're working around this here by bumping up the current z-index.
            $("button.list-group-item").css("z-index", "0");
            $("button.list-group-item").eq(selDatasetIdx).css("z-index", "1000");
            //$("#tabLink1").tab("show");
        });

        if (activeIdx!==null)
            $('#tpDatasetButton_'+activeIdx).bsButton("toggle"); // had to rename .button() in .html to bsButton
        
        // this is weird, but I have not found a better way to make the tab show up
        $("#tpOpenDialogTabs a:last").tab("show");
        $("#tpOpenDialogTabs a:first").tab("show");

        // finally, activate the default pane
        $("button.list-group-item").eq(activeIdx).trigger("focus");
    }

    function drawLayoutMenu() {
       /* Add the View / Layout menu to the DOM */
      var htmls = [];  
      var coordFiles = gCurrentDataset.coordFiles;
      for (var i=0; i<coordFiles.length; i++) {
           var label = coordFiles[i].shortLabel;
           if (label===undefined) {
               label = "Dataset "+i;
               console.log("Dataset "+i+" has no 'shortLabel' attribute");
           }
           htmls.push('<li><a href="#" class="tpDataset" id="'+i+'">'+label+'</a></li>');
      }
      $("#tpLayoutMenu").empty();
      $("#tpLayoutMenu").append(htmls.join(""));
    }

    function clearMetaBar() {
    /* empty all fields in the left-hand meta bar */
        delete gCurrentDataset.metaHist;
        var metaFields = gCurrentDataset.metaFields;
        $('#tpMetaTitle').text(METABOXTITLE);
        for (var i=0; i<metaFields.length; i++) {
            $('#tpMetaLabel_'+i).html(metaFieldToLabel(metaFields[i]));
            $('#tpMeta_'+i).html("");
        }
    }

    function updateSelection() {
    /* has to be called each time the selection has been changed */
        updateMenu();

        var cellIds = keys(gSelCellIds);
        updateGeneBarColors(cellIds);

        if (cellIds.length===0)
            clearMetaBar();
        else if (cellIds.length===1)
            updateMetaBarOneCell(cellIds[0]);
        else
            updateMetaBarManyCells(cellIds);
    }

    function onSaveAsClick() {
    /* File - Save Image as ... */
        var canvas = $("canvas")[0];
        canvas.toBlob(function(blob) { saveAs( blob , "cellBrowser.png"); } , "image/png");
    }

    function onDownloadClick() {
    /* user clicks one of the "download data" submenu links: matrix, meta or coords  */
        var name = event.target.id.split("_")[1]; // the name of the dataset
        var baseUrl = gCurrentDataset.baseUrl;
        var url = null;
        if (name==="matrix") {
            url = joinPaths([baseUrl,"geneMatrix.tsv"]);
            document.location.href = url;
        }
        if (name==="meta") {
            url = joinPaths([baseUrl,"meta.tsv"]);
            document.location.href = url;
        }
    }

    function getAllCellIdsAsList() {
    /* return a list of all cell Ids */
        var cellIds = [];
        for (var i=0; i<shownCoords.length; i++) {
            var cellId = shownCoords[i][0];
            cellIds.push(cellId);
        }
        return cellIds;
    }

    function getAllCellIdsAsDict(onlyOnScreen) {
    /* return a list of all cell Ids */
        if (onlyOnScreen===undefined)
            onlyOnScreen = false;

        var coords = [];
        if (onlyOnScreen)
            coords = pixelCoords;
        else
            coords = shownCoords;

        var cellIds = {};
        for (var i=0; i<coords.length; i++) {
            var cellId = coords[i][0];
            cellIds[cellId] = true;
        }
        return cellIds;
    }

    function onSelectAllClick() {
    /* Edit - select all visible*/
        gSelCellIds = getAllCellIdsAsDict(true);
        updateSelection();
        plotDots();
        renderer.render(stage);
    }

    function onSelectNoneClick() {
    /* Edit - Select None */
        gSelCellIds = {};
        updateSelection();
        plotDots();
        renderer.render(stage);
    }

    function onMarkClick() {
        /* Edit - mark selection (with arrows) */
        if (gCurrentDataset.markedCellIds===undefined)
            gCurrentDataset.markedCellIds = {};

        var markedIds = gCurrentDataset.markedCellIds;

        var selIds = keys(gSelCellIds);
        if (selIds.length>100) {
            warn("You cannot mark more than 100 "+gSampleDesc+"s");
            return;
        }

        for (var i = 0; i < selIds.length; i++) {
            var selId = selIds[i];
            markedIds[selId] = true;
        }

        plotDots();
        renderer.render(stage);
    }

    function onMarkClearClick() {
        gCurrentDataset.markedCellIds = {};
        plotDots();
        renderer.render(stage);
    }

    function onSelectByIdClick() {
        /* Edit - select cells by ID */
        var dlgHeight = 500;
        var dlgWidth = 500;
        var htmls = [];
        var buttons = {
        "OK" :
            function() {
                var idListStr = $("#tpIdList").val();
                idListStr = idListStr.trim().replace(/\r\n/g,"\n");
                gSelCellIds = {};
                if (idListStr==="") 
                    return;

                // first check the IDs
                var allCellIds = getAllCellIdsAsDict();
                var notFoundIds = [];
                var idList = idListStr.split("\n");
                for (var i = 0; i < idList.length; i++) {
                    var cellId = idList[i];
                    if (cellId==="")
                        continue;
                    if (!(cellId in allCellIds))
                        notFoundIds.push(cellId);
                }

                if (notFoundIds.length!==0) {
                    //alert("Could not find these "+gSampleDesc+" IDs:"+ notFoundIds.join(", "));
                    $('#tpNotFoundIds').text("Could not find these IDs: "+notFoundIds.join(", "));
                    $('#tpNotFoundHint').text("Please fix them and click the OK button to try again.");
                    }
                else {
                    for (i = 0; i < idList.length; i++) {
                        var cellId = idList[i];
                        if (cellId==="")
                            continue;
                        gSelCellIds[cellId] = true;
                        }
                    $( this ).dialog( "close" );
                    updateSelection();
                    plotDots();
                    renderer.render(stage);
                    //alert(idList.length+ " " + gSampleDesc+"s are selected");
                }
            }
        };

        htmls.push("<textarea id='tpIdList' style='height:320px;width:350px;display:block'>");
        htmls.push("</textarea><div id='tpNotFoundIds'></div><div id='tpNotFoundHint'></div>");
        var title = "Paste a list of IDs (one per line) to select "+gSampleDesc+"s";
        showDialogBox(htmls, title, {showClose:true, height:dlgHeight, width:dlgWidth, buttons:buttons});
    }

    function onExportIdsClick() {
        /* Edit - Export cell IDs */
        var idList = [];
        for (var cellId in gSelCellIds) {
            idList.push(cellId);
        }

        var dlgHeight = 500;

        var htmls = [];
        if (idList.length===0)
            {
            htmls.push("No cells are selected. Shown below are the identifiers of all cells visible on the screen.<p>");
            for (var i = 0; i < pixelCoords.length; i++)
                idList.push(shownCoords[i][0]);
            }

        var idListEnc = encodeURIComponent(idList.join("\n"));
        htmls.push("<textarea style='height:320px;width:350px;display:block'>");
        htmls.push(idList.join("\n"));
        htmls.push("</textarea>");
        
        //htmls.push('<a style="text-decoration:underline" href="data:text/plain;charset=utf-8,'+idListEnc+'" download="identifiers.txt">Download as text file</a><br>');

        //htmls.push('<a style="text-decoration:underline" href="data:text/plain;charset=utf-8,'+idListEnc+'" download="identifiers.txt">Download as text file</a><br>');

        var buttons = {
        "Download as file" :
            function() {
                var blob = new Blob([idList.join("\n")], {type: "text/plain;charset=utf-8"});
                saveAs(blob, "identifiers.txt");
            },
        "Copy to clipboard" :
            function() {
                $("textarea").select();
                document.execCommand('copy');
                $( this ).dialog( "close" );
            }
        };


        showDialogBox(htmls, "List of "+idList.length+" IDs", {showClose:true, height:dlgHeight, width:400, buttons:buttons});
    }

    function drawMenuBar() {
        /* draw the menubar at the top */
       var htmls = [];
       htmls.push("<div id='tpMenuBar'>");
       htmls.push('<nav class="navbar navbar-default navbar-xs">');

       htmls.push('<div class="container-fluid">');

         htmls.push('<div class="navbar-header">');
           htmls.push('<a class="navbar-brand" href="#">'+gTitle+'</a>');
         htmls.push('</div>');

         htmls.push('<ul class="nav navbar-nav">');

         htmls.push('<li class="dropdown">');
           htmls.push('<a href="#" class="dropdown-toggle" data-toggle="dropdown" data-submenu role="button" aria-haspopup="true" aria-expanded="false">File</a>');
           htmls.push('<ul class="dropdown-menu">');
             htmls.push('<li><a href="#" id="tpOpenDatasetLink"><span class="dropmenu-item-label">Open Dataset...</span><span class="dropmenu-item-content">o</span></a></li>');
             htmls.push('<li class="dropdown-submenu"><a tabindex="0" href="#">Download Data</a>');
               htmls.push('<ul class="dropdown-menu" id="tpDownloadMenu">');
                 htmls.push('<li><a href="#" id="tpDownload_matrix">Gene Expression Matrix</a></li>');
                 htmls.push('<li><a href="#" id="tpDownload_meta">Cell Metadata</a></li>');
                 //htmls.push('<li><a href="#" id="tpDownload_coords">Visible coordinates</a></li>');
               htmls.push('</ul>'); // Download sub-menu
             htmls.push('<li><a href="#" id="tpSaveImage">Download current image</a></li>');
             htmls.push('</li>');   // sub-menu container

           htmls.push('</ul>'); // File menu
         htmls.push('</li>'); // File dropdown

         htmls.push('<li class="dropdown">');
         htmls.push('<a href="#" class="dropdown-toggle" data-toggle="dropdown" data-submenu role="button" aria-haspopup="true" aria-expanded="false">Edit</a>');
         htmls.push('<ul class="dropdown-menu">');
         htmls.push('<li><a id="tpSelectAll" href="#"><span class="dropmenu-item-label">Select all visible</span><span class="dropmenu-item-content">a</span></a></li>');
         htmls.push('<li><a id="tpSelectNone" href="#"><span class="dropmenu-item-label">Select none</span><span class="dropmenu-item-content">n</span></a></li>');
         htmls.push('<li><a id="tpMark" href="#"><span class="dropmenu-item-label">Mark selected</span><span class="dropmenu-item-content">h m</span></a></li>');
         htmls.push('<li><a id="tpMarkClear" href="#"><span class="dropmenu-item-label">Clear marks</span><span class="dropmenu-item-content">c m</span></a></li>');
         htmls.push('<li><a id="tpSelectById" href="#">Search for ID...</a></li>');
         htmls.push('<li><a id="tpExportIds" href="#">Export selected IDs...</a></li>');
         htmls.push('</ul>'); // View dropdown
         htmls.push('</li>'); // View dropdown

         htmls.push('<li class="dropdown">');
         htmls.push('<a href="#" class="dropdown-toggle" data-toggle="dropdown" data-submenu role="button" aria-haspopup="true" aria-expanded="false">View</a>');
         htmls.push('<ul class="dropdown-menu">');

         htmls.push('<li><a href="#" id="tpZoom100Button"><span class="dropmenu-item-label">Zoom to 100%</span><span class="dropmenu-item-content">z</span></a></li>');

         htmls.push('<li><hr class="half-rule"></li>');

         htmls.push('<li><a href="#" id="tpOnlySelectedButton">Show only selected</a></li>');
         htmls.push('<li><a href="#" id="tpFilterButton">Hide selected '+gSampleDesc+'s</a></li>');
         htmls.push('<li><a href="#" id="tpShowAllButton">Show all '+gSampleDesc+'</a></li>');
         htmls.push('<li><a href="#" id="tpHideShowLabels">Hide cluster labels<span class="dropmenu-item-content">c l</span></a></li>');
         htmls.push('<li><hr class="half-rule"></li>');

         htmls.push('<li class="dropdown-submenu"><a tabindex="0" href="#">Transparency</a>');
           htmls.push('<ul class="dropdown-menu" id="tpTransMenu">');
             htmls.push('<li id="tpTrans0"><a href="#">0%</a></li>');
             htmls.push('<li id="tpTrans40"><a href="#">40%</a></li>');
             htmls.push('<li id="tpTrans60"><a href="#">60%</a></li>');
             htmls.push('<li id="tpTrans80"><a href="#">80%</a></li>');
           htmls.push('</ul>'); // Transparency sub-menu
         htmls.push('</li>');   // sub-menu container

         htmls.push('<li class="dropdown-submenu"><a tabindex="0" href="#">Circle size</a>');
           htmls.push('<ul class="dropdown-menu" id="tpSizeMenu">');
             htmls.push('<li id="tpSize1"><a href="#">1 px</a></li>');
             htmls.push('<li id="tpSize2"><a href="#">2 px</a></li>');
             htmls.push('<li id="tpSize3"><a href="#">3 px</a></li>');
             htmls.push('<li id="tpSize4"><a href="#">4 px</a></li>');
             htmls.push('<li id="tpSize5"><a href="#">5 px</a></li>');
             htmls.push('<li id="tpSize6"><a href="#">6 px</a></li>');
             htmls.push('<li id="tpSize7"><a href="#">7 px</a></li>');
             htmls.push('<li id="tpSize8"><a href="#">8 px</a></li>');
           htmls.push('</ul>'); // Circle size sub-menu
         htmls.push('</li>');   // sub-menu container

         htmls.push('</ul>'); // View dropdown-menu
         htmls.push('</li>'); // View dropdown container

         htmls.push('<li class="dropdown">');
         htmls.push('<a href="#" class="dropdown-toggle" data-toggle="dropdown" data-submenu role="button" aria-haspopup="true" aria-expanded="false">Help</a>');
         htmls.push('<ul class="dropdown-menu">');
         htmls.push('<li><a href="#" id="tpTutorialButton">Tutorial</a></li>');
         htmls.push('</ul>'); // Help dropdown-menu
         htmls.push('</li>'); // Help dropdown container

       htmls.push('</ul>'); // navbar-nav

       htmls.push('</div>'); // container
       htmls.push('</nav>'); // navbar
       htmls.push('</div>'); // tpMenuBar

       $(document.body).append(htmls.join(""));
      
       $('#tpTransMenu li a').click( onTransClick );
       $('#tpSizeMenu li a').click( onSizeClick );
       $('#tpFilterButton').click( onHideSelectedClick );
       $('#tpOnlySelectedButton').click( onShowOnlySelectedClick );
       $('#tpZoom100Button').click( onZoom100Click );
       $('#tpShowAllButton').click( onShowAllClick );
       $('#tpHideShowLabels').click( onHideShowLabelsClick );
       $('#tpExportIds').click( onExportIdsClick );
       $('#tpSelectById').click( onSelectByIdClick );
       $('#tpMark').click( onMarkClick );
       $('#tpMarkClear').click( onMarkClearClick );
       $('#tpTutorialButton').click( function()  { showIntro(false); } );
       $('#tpOpenDatasetLink').click( onOpenDatasetClick );
       $('#tpSaveImage').click( onSaveAsClick );
       $('#tpSelectAll').click( onSelectAllClick );
       $('#tpSelectNone').click( onSelectNoneClick );
       $('#tpDownloadMenu li a').click( onDownloadClick );

       // make sure that anchors under disabled li-elements are not clickable
       //$('tpMenuBar').on('click', '.disabled > a', function(e) {
           //e.preventDefault();
           //return false;
       //});

       menuBarHeight = $('#tpMenuBar').outerHeight(true);
       
       // This version is more like OSX/Windows:
       // - menus only open when you click on them
       // - once you have clicked, they start to open on hover
       // - a click anywhere else will stop the hovering
       var doHover = false;
       $(".nav > .dropdown").click( function(){ doHover = true;} );
       $(".nav > .dropdown").hover(
           function(event) { 
               if (doHover) {  
                   $(".dropdown-submenu").removeClass("open"); $(".dropdown").removeClass("open"); $(this).addClass('open'); 
               } 
           });
       $(document).click ( function() { doHover= false; });

       // This version is like the existing genome browser menu hover effect
       // activate mouse hovers for the navbar http://stackoverflow.com/a/21486327/233871
       //$(".dropdown").hover(
       //    function(){ $(this).addClass('open') },
       //    function(){ $(this).removeClass('open') }
       //);
       // do the same thing for submenus
       //$(".dropdown-submenu").hover(
       //    function(){ $(this).addClass('open') },
       //    function(){ $(this).removeClass('open') }
       //);
       // activate the submenus
       $('[data-submenu]').submenupicker();
    }

    function resizeRenderer() {
       /* resize the canvas based on current window size and number/absence of preloaded genes */
       var fromLeft = legendBarWidth+legendBarMargin;
       var width = window.innerWidth - metaBarWidth - fromLeft;

        $("#tpToolBar").css("width", width);
        $("#tpToolBar").css("height", toolBarHeight);
        $("#tpMetaBar").css("height", window.innerHeight - menuBarHeight);
        $("#tpLegendBar").css("height", window.innerHeight - menuBarHeight);

       var height  = null;
       if (gCurrentDataset.preloadExpr===null || gCurrentDataset.preloadExpr===undefined)
           height  = window.innerHeight - menuBarHeight - toolBarHeight;
       else
           height  = window.innerHeight - geneBarHeight - menuBarHeight - toolBarHeight;

       renderer.resize(width, height);
       gWinInfo = {"renderer":renderer, "width" : width, "height" : height};
    }

    function moveTo(startX, startY, x, y) {
        /* keeping current zoom factor, move viewport by a given number of pixels */
        // convert screen pixel click coords to data float values
       debug("moving to {x1}, {y1}, {x2}, {y2}", {x1:startX, y1:startY, x2:x, y2:y});
       var xDiffPx = startX - x;
       var yDiffPx = startY - y;

        var zoomRange = gCurrentDataset.zoomRange;

        _dump(zoomRange);
        //console.log("diff:" +xDiffPx+" "+yDiffPx);
        // convert pixel range to data scale range
        var xDiffData = xDiffPx * ((zoomRange.maxX - zoomRange.minX) / gWinInfo.width);
        var yDiffData = yDiffPx * ((zoomRange.maxY - zoomRange.minY) / gWinInfo.height);

        // move zoom range 
        zoomRange.minX = zoomRange.minX + xDiffData;
        zoomRange.maxX = zoomRange.maxX + xDiffData;

        zoomRange.minY = zoomRange.minY + yDiffData;
        zoomRange.maxY = zoomRange.maxY + yDiffData;

        pushZoomState(zoomRange);

        _dump(zoomRange);
        pixelCoords = scaleData(shownCoords);
    }

    function panGlyphs(x, y) {
        /* pan, relative to the last pan position */
        if (lastPanX===null) {
            lastPanX = x;
            lastPanY = y;
        }
        var xDiff = (x - lastPanX);
        var yDiff = (y - lastPanY);
        lastPanX = x;
        lastPanY = y;
        console.log('pan '+xDiff+' '+yDiff);
        for (var i = 0; i < visibleGlyps.length; i++) {
            var dot = visibleGlyps[i];
            dot.x += xDiff;
            dot.y += yDiff;
        }
       renderer.render(stage);
    }

    function drawMarquee(x, y) {
        var selectWidth = Math.abs(x - mouseDownX);
        var selectHeight = Math.abs(y - mouseDownY);
        var minX = Math.min(x, mouseDownX);
        var minY = Math.min(y, mouseDownY);
        var posCss = {
             "left":minX + metaBarWidth+metaBarMargin, 
             "top": minY + menuBarHeight+toolBarHeight,
             "width":selectWidth,
             "height":selectHeight
        };
        $("#tpSelectBox").css(posCss).show();
    }

    function resetSelection() {
       $("#tpSelectBox").hide();
       mouseDownX = null;
       mouseDownY = null;
       lastPanX = null;
       lastPanY = null;
       if (!jQuery.isEmptyObject(gSelCellIds)) {
           gSelCellIds = {};
           updateSelection();
           plotDots();
           renderer.render(stage);
       }
    }

    function zoomTo(x1, y1, x2, y2) {
       /* zoom to rectangle defined by two points */
       // address case when the mouse movement was upwards
       var pxMinX = Math.min(x1, x2);
       var pxMaxX = Math.max(x1, x2);

       var pxMinY = Math.min(y1, y2);
       var pxMaxY = Math.max(y1, y2);

       // OK, we're zooming:
       // force the zoom rectangle to have the same aspect ratio as our canvas
       // by adapting the height
       var aspectRatio = gWinInfo.width / gWinInfo.height;
       var rectWidth  = (pxMaxX-pxMinX);
       var newHeight = rectWidth/aspectRatio;
       pxMaxY = pxMinY + newHeight;

       // convert screen pixel click coords to data float values
       var zoomRange = gCurrentDataset.zoomRange;

       // window size in data coordinates
       var spanX = zoomRange.maxX - zoomRange.minX;
       var spanY = zoomRange.maxY - zoomRange.minY;

       // multiplier to convert from pixels to data coordinates
       var xMult = spanX / gWinInfo.width; // multiplier
       var yMult = spanY / gWinInfo.height;

       var oldMinX = zoomRange.minX;
       var oldMinY = zoomRange.minY;

       zoomRange.minX = oldMinX + (pxMinX * xMult);
       zoomRange.minY = oldMinY + (pxMinY * yMult);

       zoomRange.maxX = oldMinX + (pxMaxX * xMult);
       zoomRange.maxY = oldMinY + (pxMaxY * yMult);

       pushZoomState(zoomRange);

       pixelCoords = scaleData(shownCoords);
    }

    function onBackgroundMouseMove(ev) {
        /* called when the mouse is moved over the Canvas */
        console.log("background move");
        // stop quickly is we can, as this is called for every mouse move
        if (mouseDownX === null && lastPanX === null)
            return;

        var x = ev.data.global.x;
        var y = ev.data.global.y;
        if (ev.data.originalEvent.altKey || dragMode==="move")
            panGlyphs(x, y);
        else
            drawMarquee(x, y);
    }

    function onBackgroundMouseDown (ev) {
    /* click on background */
        // just keep the coordinates, do nothing else
       console.log("background mouse down");
       if (ev.data.originalEvent.altKey || dragMode==="move") {
           console.log("background mouse down, with meta");
           lastPanX = ev.data.global.x;
           lastPanY = ev.data.global.y;
       } 
       mouseDownX = ev.data.global.x;
       mouseDownY = ev.data.global.y;
    }

    function onBackgroundMouseUp(ev) {
       console.log("background mouse up");
       if (mouseDownX === null && lastPanX === null)  {
           // user started the click outside of the canvas: do nothing
           console.log("first click must have been outside of canvas");
           return;
       }
       var x = ev.data.global.x;
       var y = ev.data.global.y;
       // user just clicked on a dot (pixi sent the event to two listeners, the dot and the background. pixi bug? )
       // -> do nothing
       if (dotClickX!==null && (dotClickX === x && dotClickY === y)) {
           console.log("click on dot");
           dotClickX = null;
           dotClickY = null;
           mouseDownX = null;
           mouseDownY = null;
           lastPanX = null;
           lastPanY = null;
           return;
       }
       
       // user did not move the mouse: reset everything
       if (mouseDownX === x && mouseDownY === y) {
           console.log("not moved at all: reset "+x+" "+mouseDownX+" "+mouseDownY+" "+y);
           resetSelection();
           return;
       }
       console.log("moved: reset "+x+" "+mouseDownX+" "+mouseDownY+" "+y);

       var oEv = ev.data.originalEvent;
       var anyKey = (oEv.metaKey || oEv.altKey || oEv.shiftKey);
       // panning
       if ((dragMode==="move" && !anyKey) || oEv.altKey )
           moveTo(mouseDownX, mouseDownY, x, y);
       else if ((dragMode==="zoom" && !anyKey) || oEv.metaKey )
           zoomTo(mouseDownX, mouseDownY, x, y);
       // marquee select 
       else if ((dragMode==="select" && !anyKey) || oEv.shiftKey )
           selectCellsInRect(mouseDownX, mouseDownY, x, y);
       else {
           console.log("Internal error: no mode?");
       }

       mouseDownX = null;
       mouseDownY = null;
       lastPanX = null;
       lastPanY = null;
       $("#tpSelectBox").hide();
       $("#tpSelectBox").css({"width":0, "height":0});

       plotDots();
       renderer.render(stage);
    }

    function createRenderer() {
    /* Create the renderer, sideeffect: sets the "stage" global. 
     * menuBarHeight needs to be set before calling this.
     */
       var opt = { antialias: true, transparent: true };

       //renderer = new PIXI.WebGLRenderer(0, 0, opt);
       //renderer = PIXI.autoDetectRenderer(0, 0, opt);
       renderer = new PIXI.CanvasRenderer(0, 0, opt);

       // setup the mouse zooming callbacks
       renderer.plugins.interaction.on('mousedown', onBackgroundMouseDown);
       renderer.plugins.interaction.on('mousemove', onBackgroundMouseMove );
       renderer.plugins.interaction.on('mouseup', onBackgroundMouseUp);

       // add the divs for the selection rectangle
       var htmls = [];
       htmls.push("<div style='position:absolute; display:none' id='tpSelectBox'></div>");
       //htmls.push("<div style='position:absolute; left:"+fromLeft+"px;' id='tpMiddle'>");
       $(document.body).append(htmls.join(""));

       $(window).resize(onResize);
       
       renderer.view.style.border = "1px solid #AAAAAA";
       renderer.backgroundColor = 0xFFFFFF;

       // fill the whole window
       renderer.view.style.position = "absolute";
       renderer.view.style.display = "block";
       renderer.view.style.left = metaBarWidth+metaBarMargin+"px";
       renderer.view.style.top = (menuBarHeight+toolBarHeight)+"px";
       renderer.autoResize = true;

       console.log(renderer.type);
       if (renderer.type instanceof PIXI.CanvasRenderer) {
           console.log('Using Canvas');
       } else {
           console.log('Using WebGL');
       } 

       $(document.body).append(renderer.view);
       resizeRenderer();

    }

    function onTransClick(ev) {
    /* user has clicked transparency menu entry */
        var transText = ev.target.innerText;
        var transStr = transText.slice(0, -1); // remove last char
        var transFloat = 1.0 - (parseFloat(transStr)/100.0);
        transparency = transFloat;        
        plotDots();
        $("#tpTransMenu").children().removeClass("active");
        $("#tpTrans"+transStr).addClass("active");
        renderer.render(stage);
    }

    function buildLegend(sortBy) {
    /* build the gLegend and gClasses globals */
        if (gLegend.type=="meta")
            {
            gLegend = buildLegendForMeta(gLegend.metaFieldIdx, sortBy);
            gClasses = assignCellClasses();
            }
        else {
            var geneIdx = gLegend.geneIdx;
            var geneInfo = gCurrentDataset.preloadExpr.genes[geneIdx];
            var geneId = geneInfo[0];
            var geneSym = geneInfo[1];
            var deciles = gCurrentDataset.preloadExpr.deciles[geneId];
            var cellExpr = gCurrentDataset.preloadExpr.cellExpr;
            buildLegendForExprAndClasses(geneIdx, geneSym, deciles, cellExpr);
        }
    }

    function filterCoordsAndUpdate(cellIds, mode) {
    /* hide/show currently selected cell IDs or "show all". Rebuild the legend and the coloring. */
        if (mode=="hide")
            shownCoords = removeCellIds(shownCoords, cellIds);
        else if (mode=="showOnly")
            shownCoords = showOnlyCellIds(shownCoords, cellIds);
        else
            shownCoords = allCoords.slice();

        pixelCoords = scaleData(shownCoords);

        buildLegend();
        drawLegend();
        gSelCellIds = {};
        plotDots();
        renderer.render(stage);
        menuBarShow("#tpShowAllButton");
    }

    function onHideSelectedClick(ev) {
    /* user clicked the hide selected button */
        filterCoordsAndUpdate(gSelCellIds, "hide");
        menuBarHide("#tpFilterButton");
        menuBarHide("#tpOnlySelectedButton");
        menuBarShow("#tpShowAllButton");
        ev.preventDefault();
    }

    function onShowOnlySelectedClick(ev) {
    /* user clicked the only selected button */
        filterCoordsAndUpdate(gSelCellIds, "showOnly");
        menuBarHide("#tpFilterButton");
        menuBarHide("#tpOnlySelectedButton");
        menuBarShow("#tpShowAllButton");
        ev.preventDefault();
    }

    function onShowAllClick(ev) {
    /* user clicked the show all menu entry */
        //gSelCellIds = {};
        filterCoordsAndUpdate(gSelCellIds, "showAll");
        shownCoords = allCoords.slice(); // complete copy of list, fastest in Blink
        pixelCoords = scaleData(shownCoords);
        buildLegend();
        drawLegend();
        gClasses = assignCellClasses();
        plotDots();
        menuBarHide("#tpFilterButton");
        menuBarHide("#tpOnlySelectedButton");
        menuBarHide("#tpShowAllButton");
        gLegend.lastClicked = null;
        renderer.render(stage);
    }

    function onHideShowLabelsClick(ev) {
    /* user clicked the hide labels / show labels menu entry */
        if ($("#tpHideShowLabels").text()===SHOWLABELSNAME) {
            gCurrentDataset.showLabels = true;
            $("#tpHideShowLabels").text(HIDELABELSNAME);
        }
        else {
            gCurrentDataset.showLabels = false;
            $("#tpHideShowLabels").text(SHOWLABELSNAME);
        }

        plotDots();
        renderer.render(stage);
    }

    function onSizeClick(ev) {
    /* user clicked circle size menu entry */
        var sizeText = ev.target.innerText;
        var sizeStr = sizeText.slice(0, 1); // keep only first char
        circleSize = parseInt(sizeStr);        
        $("#tpSizeMenu").children().removeClass("active");
        $("#tpSize"+circleSize).addClass("active");
        plotDots();
        renderer.render(stage);
    }

    function onZoom100Click(ev) {
    /* zoom to 100% */
        circleSize = defaultCircleSize;
        gCurrentDataset.zoomRange = cloneObj(gCurrentDataset.zoomFullRange);
        pixelCoords = scaleData(shownCoords);
        pushZoomState(null);
        plotDots();
        renderer.render(stage);
        ev.preventDefault();
    }

    function activateMode(modeName) {
    /* switch to one of the mouse drag modes: zoom, select or move */
        dragMode=modeName; 
        $(".tpIconButton").removeClass('tpClicked'); 
        $("#tpIconMode"+capitalize(modeName)).blur().addClass("tpClicked"); 
        if (modeName==="move")
            $('canvas').css('cursor','all-scroll');
        else if (modeName==="zoom")
            $('canvas').css('cursor','crosshair');
        else 
            $('canvas').css('cursor','default');
    }

    function zoom(scale) {
    /* zoom to the center by a given factor */
        circleSize *= (1.0-scale);
        var zoomRange = gCurrentDataset.zoomRange;
        var xRange = Math.abs(zoomRange.maxX-zoomRange.minX);
        zoomRange.minX = zoomRange.minX - (xRange*scale);
        zoomRange.maxX = zoomRange.maxX + (xRange*scale);

        var yRange = Math.abs(zoomRange.maxY-zoomRange.minY);
        zoomRange.minY = zoomRange.minY - (yRange*scale);
        zoomRange.maxY = zoomRange.maxY + (yRange*scale);
       
        pushZoomState(zoomRange);
        pixelCoords = scaleData(shownCoords);
        plotDots();
        renderer.render(stage);
    }

    function onZoomOutClick(ev) {
        zoom(0.2);
        ev.preventDefault();
    }

    function onZoomInClick(ev) {
        zoom(-0.2);
        ev.preventDefault();
    }

    function onResize(ev) {
        /* called when window is resized by user */
        resizeRenderer();
        pixelCoords = scaleData(shownCoords);
        var legendBarLeft = gWinInfo.width+metaBarMargin+metaBarWidth;
        $('#tpLegendBar').css('left', legendBarLeft+"px");
        var geneBarTop = gWinInfo.height+menuBarHeight+geneBarMargin+toolBarHeight;
        buildGeneBar();
        plotDots();
        renderer.render(stage);
    }

    function drawLegendBar() {
        // create an empty right side legend bar
        var legendLeft = metaBarWidth+metaBarMargin+gWinInfo.width;
        var htmls = [];
        htmls.push("<div id='tpLegendBar' style='position:absolute;top:"+menuBarHeight+"px;left:"+legendLeft+"px; width:"+legendBarWidth+"px'>");
        htmls.push("<div id='tpLegendTitle' style='position:relative; width:100%; height:1.5em; font-weight: bold'>");
        htmls.push("Legend:");
        htmls.push("</div>"); // title
                    htmls.push("<div id='tpLegendContent'>");
                    htmls.push("</div>"); // content 
        htmls.push("</div>"); // bar 
        $(document.body).append(htmls.join(""));
    }

    function getTextWidth(text, font) {
        // re-use canvas object for better performance
        // http://stackoverflow.com/questions/118241/calculate-text-width-with-javascript
        var canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
        var context = canvas.getContext("2d");
        context.font = font;
        var metrics = context.measureText(text);
        return metrics.width;
    }

    function populateTable(table, rows, cells, content) {
    /* build table from DOM objects */
        var is_func = (typeof content === 'function');
        if (!table) table = document.createElement('table');
        for (var i = 0; i < rows; i++) {
            var row = document.createElement('tr');
            for (var j = 0; j < cells; j++) {
                row.appendChild(document.createElement('td'));
                var text = !is_func ? (content + '') : content(table, i, j);
                row.cells[j].appendChild(document.createTextNode(text));
            }
            table.appendChild(row);
        }
        return table;
    }

    function makeColorMap(legendRows) {
    /* go over the legend lines, create a map colorMapKey : color */
        var colorMap = {};
        for (var i = 0; i < legendRows.length; i++) {
            var colorMapKey = legendRows[i][4];
            var color = legendRows[i][0];
            colorMap[colorMapKey] = color;
        }
        return colorMap;
    }

    function loadColors(legendRows) {
    /* go over the legend lines, use the unique key to find the manually
     * defined colors in localStorage or in gOptions.metaColors */
        var metaColors = gCurrentDataset.metaColors;
        for (var i = 0; i < legendRows.length; i++) {
            var legKey = legendRows[i][5];
            var defColor = legendRows[i][1];
            var legLabel = legendRows[i][2];
            // first check localstorage
            var color = localStorage.getItem(legKey);
            if (metaColors !== undefined && ((color===undefined) || (color===null))) {
                    color = metaColors[legLabel];
            }

            if (color===undefined || color === null) {
                color=defColor;
            }
            legendRows[i][0] = color;
        }
        return legendRows;
    }

    function assignCellClasses() {
    /* return a map cellId:colorInteger, based on the currently active meta field */
        var metaIdx = gLegend.metaFieldIdx;

        if (gLegend.rows===undefined)
            return;

        // build map meta val -> legendId
        var metaToLegend = {};
        var rows = gLegend.rows;
        var metaVal = null;
        for (var i = 0; i < rows.length; i++) {
            metaVal = rows[i][4];
            metaToLegend[metaVal] = i;
        }

        var metaData = gCurrentDataset.metaData;
        var cellIdToLegendId = {};
        for (var j = 0; j < allCoords.length; j++) {
            var cellId = allCoords[j][0];
            var cellMeta = metaData[cellId];
            var metaVal = null;
            if (cellMeta===undefined)
                metaVal = "(missingMetaData)";
            else
                metaVal = metaData[cellId][metaIdx];
            cellIdToLegendId[cellId] = metaToLegend[metaVal];
        }
        return cellIdToLegendId;
    }

    function newArray(n, val) {
        /* return an array initialized with val */
        var arr = new Array(n);
        for (var i = 0; i < n; i++)
            arr[i] = val;
        return arr;
    }

    function findBin(ranges, val) {
    /* given an array of values, find the index i where ranges[i] < val < ranges[i+1] */
    /* XX performance - use binary search */
    for (var i = 0; i < ranges.length-1; i++) {
        if ((val >= ranges[i]) && (val <= ranges[i+1]))
            return i;
        }
    }

    function buildLegendForExprAndClasses(geneIdx, geneSym, deciles, cellToExpr) {
        /* build legend for expression and update the gClasses global var 
         * cellToExpr object with cellId -> array, geneIdx points to the right value
         * */

        $('#tpLegendTitle').html(geneSym+" expression");
        
        // get count for each decile and the special bin for null values
        // for all currently shown cells
        var decileCounts = newArray(10, 0);
        var nullCount = 0;
        var cellToClass = {};
        for (var i = 0; i < shownCoords.length; i++) {
            var cellId = shownCoords[i][0];
            var exprVal = cellToExpr[cellId][geneIdx];  // somewhat wasteful, at least for single genes

            if (exprVal===null)
                {
                nullCount++;
                cellToClass[cellId] = 0;
                }
            else {
                var binIdx = findBin(deciles, exprVal);
                decileCounts[binIdx]++;
                cellToClass[cellId] = binIdx+1; // binIdx 0 is reserved for the null count
            }
        }

        var legendRows = [];
        // "no value" 
        legendRows.push( [ cNullColor, cNullColor, "No Value", nullCount, 0, geneSym+"|null"] );

        if ( deciles!==null ) {
            var defColors = makeColorPalette(10, true);
            for (var j = 0; j < (deciles.length-1); j++) {
                var count = decileCounts[j];
                var binMin = deciles[j];
                var binMax = deciles[j+1];
                var legendId = j+1; // bin 0 is reserved for null, so legendId = binIdx+1
                var legLabel = binMin.toFixed(2)+' to '+binMax.toFixed(2);

                var defColor = defColors[j];
                var uniqueKey = geneSym+"|"+legLabel;
                legendRows.push( [ defColor, defColor, legLabel, count, legendId, uniqueKey] );
            }
        }

    gLegend.rows = loadColors(legendRows);
    gClasses = cellToClass;
    }

    function onGeneClick (event) {
    /* user clicked on a gene in the gene bar: sort expression vals into deciles and color by them  */
        var geneIdx = parseInt(event.target.id.split("_")[1]); // the index of the gene
        $('.tpMetaBox').removeClass('tpMetaSelect');
        $('.tpGeneBarCell').removeClass("tpGeneBarCellSelected");
        $('#tpGeneBarCell_'+geneIdx).addClass("tpGeneBarCellSelected");
        gSelCellIds = {};
        gLegend = {};
        gLegend.type = "gene";
        gLegend.geneIdx = geneIdx;
        buildLegend();
        drawLegend();
        plotDots();
        renderer.render(stage);
    }

    function showDialogBox(htmlLines, title, options) {
        /* show a dialog box with html in it */
        $('#tpDialog').remove();

        var addStr = "";
        if (options.width!==undefined)
            addStr = "max-width:"+options.width+"px;";
        var maxHeight = $(window).height()-200;
        // unshift = insert at pos 0
        htmlLines.unshift("<div style='display:none;"+addStr+"max-height:"+maxHeight+"px' id='tpDialog' title='"+title+"'>");
        htmlLines.push("</div>");
        $(document.body).append(htmlLines.join(""));
        var dialogOpts = {modal:true};
        if (options.width!==undefined)
            dialogOpts["width"] = options.width;
        if (options.height!==undefined)
            dialogOpts["height"] = options.height;
        dialogOpts["maxHeight"] = maxHeight;
        if (options.buttons!==undefined)
            dialogOpts["buttons"] =  options.buttons;
        else
            dialogOpts["buttons"] =  {};

        if (options.showOk!==undefined)
            dialogOpts["buttons"].OK = function() { $( this ).dialog( "close" ); };
        if (options.showClose!=undefined)
            dialogOpts["buttons"].Cancel = function() { $( this ).dialog( "close" ); };
        //dialogOpts["position"] = "center";
        //dialogOpts["height"] = "auto";
        //dialogOpts["width"] = "auto";

        $( "#tpDialog" ).dialog(dialogOpts);
    }

    function onChangeGenesClick(ev) {
    /* called when user clicks the "change" button in the gene list */
        var htmls = [];
        htmls.push("<p style='padding-bottom: 5px'>Enter a list of gene symbols, one per line:</p>");
        htmls.push("<textarea id='tpGeneListBox' class='form-control' style='height:320px'>");

        var geneFields = gCurrentDataset.preloadGenes.genes;
        for (var i = 0; i < geneFields.length; i++) {
            htmls.push(geneFields[i][1]+"\r\n");
        }
        htmls.push("</textarea>");
        //htmls.push("<p>");
        //htmls.push("<button style='float:center;' id='tpGeneDialogOk' class='ui-button ui-widget ui-corner-all'>OK</button>");
        //htmls.push("</div>");
        //htmls.push("</div>");
        var buttons = {"OK" : onGeneDialogOkClick };
        showDialogBox(htmls, "Genes of interest", {height: 500, width:400, buttons:buttons});

        $('#tpGeneDialogOk').click ( onGeneDialogOkClick );
    }

    function getSortedCellIds() {
        /* return the cellId names of the expression matrix */
        // get the sorted list of cell IDs - XX is there a risk that the matrix does not have a sorted order? 
        // XX Risk of python sorting a different way than javascript?
        var metaData = gCurrentDataset.metaData;
        var cellIds = [];
        for (var cellId in metaData) {
            cellIds.push(cellId);
        }
        cellIds.sort();
        return cellIds;
    }

    function onGeneLoadComplete() {
        /* called when all gene expression vectors have been loaded */
        console.log("All genes complete");
        // Close the dialog box only if all genes were OK. The user needs to see the list of skipped genes
        if ( $( "#tpNotFoundGenes" ).length===0 ) {
            $("#tpDialog").dialog("close");
        }

        var cellIds = getSortedCellIds();

        // transform the data from tpLoadGeneExpr as gene -> list of values (one per cellId) to 
        // newExprData cellId -> list of values (one per gene)
        
        // initialize an empty dict cellId = floats, one per gene
        var newExprData = {};
        var geneCount = gLoad_geneList.length;
        var cellIdCount = cellIds.length;
        for (var i = 0; i < cellIdCount; i++) {
            cellId = cellIds[i];
            newExprData[cellId] = new Float32Array(gLoad_geneList); // XX or a = [] + a.length = x ?
        }

        // do the data transform
        var newGeneFields = [];
        var newDeciles = {};
        for (var geneI = 0; geneI < gLoad_geneList.length; geneI++) {
            var geneSym = gLoad_geneList[geneI];
            var geneInfo = gLoad_geneExpr[geneSym];

            var geneId = geneInfo[0];
            var geneVec = geneInfo[1];
            var deciles = geneInfo[2];
            newGeneFields.push( [geneSym, geneId] );
            newDeciles[geneSym] = deciles;

            for (var cellI = 0; cellI < cellIdCount; cellI++) {
                cellId = cellIds[cellI];
                newExprData[cellId][geneI] = geneVec[cellI];
            }
        }

        gLoad_geneList = null;
        gLoad_geneExpr = null;

        gCurrentDataset.preloadExpr = {};
        gCurrentDataset.preloadExpr.genes = newGeneFields;
        gCurrentDataset.preloadExpr.cellExpr = newExprData;
        gCurrentDataset.preloadExpr.deciles = newDeciles;

        buildGeneBar(); 
    }

    function parseMatrixLine(line) {
        /* parse tsv line with first field being the geneId. Return as [geneId, [float1, float2, ...]] */
        var fields = line.split("\t");
        var geneId = fields[0];
        // convert all but the first field to a new array of floats
        var exprVec = [];
        for (var i = 1; i < fields.length; i++) {
            exprVec.push( parseFloat(fields[i]));
        }
        //exprVec = new Float32Array(exprVec);
        var exprTuple = [geneId, exprVec];
        return exprTuple;
    }

    function onReceiveExprLineProgress(line) {
        /* called when a line of the expression matrix has been loaded: parse line and upd. progressbar */
        var symbol = this.geneSymbol;
        console.log("Got gene "+symbol);
        var exprTuple = parseMatrixLine(line);
        var exprVec = exprTuple[1];
        exprTuple.push( getDeciles(exprVec) );
        gLoad_geneExpr[symbol] = exprTuple;

        var progressbar = $( "#tpGeneProgress" );
        var val = progressbar.progressbar( "value" ) || 0 ;
        val++;
        progressbar.progressbar( "value", val );
        $( "#tpProgressLabel" ).text(symbol);

        var progrMax = progressbar.progressbar("option", "max");
        if (val >= progrMax)
            onGeneLoadComplete();
    }

    /**
     from https://stackoverflow.com/questions/29855098/is-there-a-built-in-javascript-function-similar-to-os-path-join:
     * Joins 2 paths together and makes sure there aren't any duplicate seperators
     * @param parts the parts of the url to join. eg: ['http://google.com/', '/my-custom/path/']
     * @param separator The separator for the path, defaults to '/'
     * @returns {string} The combined path
     */
    function joinPaths(parts, separator) {
      return parts.map(function(part) { return part.trim().replace(/(^[\/]*|[\/]*$)/g, ''); }).join(separator || '/');
    }

    function getDeciles(arr) {
    /* return the deciles for an array of floats, line-by-line python->js port from cbPrep */
        var values = arr.slice(0).sort(); // make sorted copy of array
        var binSize = ((values.length)-1.0) / 10.0;

        // get deciles from the list of sorted values
        var deciles = [];
        var pos = 0;
        for (var i = 0; i < 11; i++) { // 10 bins means 11 ranges
            pos = Math.floor(binSize * i); // ? could this ever exceed len(values) due to floating point issues?
            if (pos > values.length) {
                console.log("Warning - getDecile: pos > length of vector");
                pos = values.length;
            }
            deciles.push(values[pos]);
    }
    return deciles;
    }

    function singleExprDone() {
    /* called when both cellIds(header) and single line of the expr matrix have been read */
        var sExpr = gCurrentDataset.singleExpr;
        if (sExpr.exprVec===undefined || gCurrentDataset.matrixCellIds==undefined)
            // don't proceed if one part of the data is not here yet
            return;

        // convert the expression vector to a dict cellId -> array of float, with a single value
        var cellToExpr = {};
        var exprVec = sExpr.exprVec;
        var cellIds = gCurrentDataset.matrixCellIds;
        for (var i = 0; i < cellIds.length; i++) {
            var cellId = cellIds[i];
            var val = [exprVec[i]];
            cellToExpr[cellId] = val;
        }

        var geneSym = sExpr.symbol;
        console.log("XX here with symbol"+geneSym);
        if (geneSym !== null) {
            console.log("XX adding to combo"+geneSym);
            var select = $("#tpGeneCombo").selectize();
            var selectize = select[0].selectize;
            //var optId = selectize.search(geneSym);
            selectize.addOption({text: geneSym, value: geneSym});
            selectize.refreshOptions();
            selectize.setTextboxValue(geneSym);
        }

        buildLegendForExprAndClasses(0, sExpr.symbol, sExpr.deciles, cellToExpr);
        drawLegend();
        plotDots();
        renderer.render(stage);

    }

    function onReceiveMatrixSingleExprLine(line) {
        /* got a single expression line from the matrix, no progressbar */
        var sExpr = gCurrentDataset.singleExpr;
        sExpr.symbol = this.geneSymbol;
        console.log("Got gene vector for "+sExpr.symbol);
        var exprTuple = parseMatrixLine(line);
        sExpr.geneId  = exprTuple[0];
        sExpr.exprVec = exprTuple[1];
        sExpr.deciles = getDeciles(sExpr.exprVec);

        singleExprDone();
    }

    function onReceiveMatrixHeader(line) {
        /* received the */
        line = line.trim(); // old index script had a bug where it added a newline
        var fields = line.split("\t");
        var cellIds = fields.slice(1); // copy all but first
        console.log("Got header, cellCount="+cellIds.length);
        gCurrentDataset.matrixCellIds = cellIds;
        singleExprDone();
    }

    function loadSingleGeneFromMatrix(geneSym) {
        /* load gene expression of a single gene, build legend and color by it */
        gCurrentDataset.singleExpr = {};

        var url = joinPaths([gCurrentDataset.baseUrl, "geneMatrix.tsv"]);

        // load the cell IDs (header line), if we don't have it yet
        if (gCurrentDataset.matrixCellIds==undefined) {
            var offsetInfo = gCurrentDataset.matrixOffsets["_header"];
            var start = offsetInfo[0];
            var end = start+offsetInfo[1];
            // Trying to fix this bug https://github.com/igvteam/igv.js/issues/424 by appending the gene symbol
            // (not a random number, like JimR in IGV, but hopefully works just as well, hopefully even preserving caching )
            jQuery.ajax( { url: url+"?"+"header",
                headers: { Range: "bytes="+start+"-"+end } ,
                success: onReceiveMatrixHeader
            });
        }

        // load the expression vector
        offsetInfo = gCurrentDataset.matrixOffsets[geneSym];
        start = offsetInfo[0];
        end = start+offsetInfo[1];
        
        jQuery.ajax( { url: url+"?"+geneSym,
            headers: { Range: "bytes="+start+"-"+end } ,
            geneSymbol : geneSym,
            success: onReceiveMatrixSingleExprLine
        });
    }

    function onGeneDialogOkClick(ev) {
    /* called the user clicks the OK button on the 'paste your genes' dialog box */
        var genes = $('#tpGeneListBox').val().replace(/\r\n/g, "\n").split("\n");
        $("#tpDialog").remove();

        gLoad_geneList = [];
        gLoad_geneExpr = {};

        var notFoundGenes = [];
        var baseUrl = gCurrentDataset.baseUrl;
        var url = joinPaths([baseUrl, "geneMatrix.tsv"]);
        var validCount = 0; // needed for progressbar later
        var matrixOffsets = gCurrentDataset.matrixOffsets;
        for (var i = 0; i < genes.length; i++) {
            var gene = genes[i];
            if (gene.length===0) // skip empty lines
                continue;
            if (!(gene in matrixOffsets))
                {
                notFoundGenes.push(gene);
                continue;
                }

            gLoad_geneList.push(gene);
            var offsetInfo = matrixOffsets[gene];
            var start = offsetInfo[0];
            var end = start+offsetInfo[1];
            jQuery.ajax( { url: url,
                headers: { Range: "bytes="+start+"-"+end } ,
                geneSymbol : gene,
                success: onReceiveExprLineProgress
            });
        }

        var htmls = [];
        htmls.push("<div id='tpGeneProgress'><div class='tpProgressLabel' id='tpProgressLabel'>Loading...</div></div>");

        if (notFoundGenes.length!=0) {
            htmls.push("<div id='tpNotFoundGenes'>Could not find the following gene symbols: ");
            htmls.push(notFoundGenes.join(", "));
            htmls.push("</div>");
            //htmls.push("<button style='float:center;' id='tpGeneDialogOk' class='ui-button ui-widget ui-corner-all'>OK</button>");
            //for (var i = 0; i < notFoundGenes.length; i++) {
                //htmls.push(notFoundGenes[i]);
            //}
            //htmls.push("<p>Could not find the following gene symbols:</p>");
            //showDialogBox(htmls, "Warning", 400); 
        }

        var showOk = (notFoundGenes.length!=0);
        showDialogBox(htmls, "Downloading expression data", {width:350, showOk:true});

        var progressLabel = $( "#tpProgressLabel" );
        $("#tpGeneProgress").progressbar( {
              value: false,
              max  : gLoad_geneList.length
              });

    }

    function buildGeneBar() {
    /* create bottom gene expression info bar */
        $('#tpGeneBar').remove();
        if (gCurrentDataset.preloadExpr===null || gCurrentDataset.preloadExpr===undefined)
            return;
        var geneFields = gCurrentDataset.preloadExpr.genes;

        var canvasEl = $("canvas");
        var canvasWidth = parseInt(canvasEl.css("width").replace("px", ""));
        var canvasHeight = parseInt(canvasEl.css("height").replace("px", ""));

        var barTop = menuBarHeight+toolBarHeight+canvasHeight+geneBarMargin;
        var barLeft = metaBarWidth+metaBarMargin;

        $(document.body).append("<div id='tpGeneBar' style='position:absolute;top:"+barTop+"px;left:"+barLeft+"px;width:"+canvasWidth+"px; height:"+geneBarHeight+"px; background-color:light-grey'></div>");

        var html = [];
        html.push('<table id="tpGeneTable"><tr>');
        html.push('<td><button id="tpChangeGenes" title="Change the list of genes that are displayed in this table" class = "ui-button ui-widget ui-corner-all" style="width:95%">Change</button></td>');

        var cellWidth = 60; // -> must correspond to CSS class tpGeneBarCell + padding + border
        var colsPerRow = Math.floor(canvasWidth / cellWidth);

        var currWidth = 1;
        for (var i = 0; i < geneFields.length; i++) {
            var geneInfo = geneFields[i];
            var geneId   = geneInfo[0];
            var geneName = geneInfo[1];
            var geneDesc = geneInfo[2];
            if (((i % colsPerRow) == 0) && (i!=0)) {
                html.push("</tr><tr>");
                currWidth=0;
            }
            html.push('<td title="'+geneDesc+'" id="tpGeneBarCell_'+i+'" class="tpGeneBarCell">'+geneName+'</td>');
            currWidth += cellWidth;
        }
        html.push("</tr></table>");

        var geneBarEl = $('#tpGeneBar');
        geneBarEl.append(html.join("")); // much faster than creating indiv. DOM elements.
        $('.tpGeneBarCell').click( onGeneClick );
        $('#tpChangeGenes').click( onChangeGenesClick );
    }

    function addMenus() {
        // build the color-by menu
        $('#tpMetaBar').append('<ul class="tpMenu" id="tpColorByMenu" style="display:none">');
        for (var i = 0; i < fields.length; i++) {
            var fieldName = fields[i];
            $('#tpColorByMenu').append('<li><div>'+fieldName+'</div></li>');
        }
        $('#tpColorByMenu').append('</ul>');
        $( "#tpColorByMenu" ).menu();

        var tpColorByLink = $("#tpColorByLink");
        tpColorByLink.click(function() {
          var menu = $('#tpColorByMenu');
          if (menu.is(":visible"))
              {
              console.log("hide it");
              menu.hide();
              }
          else
              {
              console.log("show it");
              menu.show();
              }
        });

        // close menu when document is clicked anywhere else -- ? performance ?
        var tpMenuEl = $('.tpMenu');
        $(document).click(function(e) {
            clicked = $(e.target);
            if (clicked[0]===tpColorByLink[0])
                return;
            if(!$.contains(tpMenuEl, clicked)) {
                console.log("clicked outside, now hiding");
                $('.tpMenu').hide();
            }
        });
    }

    function likeEmptyString(label) {
    /* some special values like "undefined" and empty string get colored in grey  */
        return (label===null || label.trim()==="" || label==="none" || label==="None" 
                || label==="Unknown" || label==="NaN" || label==="NA" || label==="undefined" || label=="Na")
    }

    function buildLegendForMeta(metaIndex, sortBy) {
    /* Build a new gLegend object and return it */
        var legend = {};
        legend.type = "meta";
        legend.metaFieldIdx = metaIndex;
        legend.fieldName = gCurrentDataset.metaFields[metaIndex];

        // first make a list of all possible meta values and their counts
        var metaData = gCurrentDataset.metaData;
        var metaCounts = {};
        for (var i = 0; i < allCoords.length; i++) {
            var cellId = allCoords[i][0];
            var metaRow = metaData[cellId];
            var metaVal = null;
            if (metaRow===undefined)
                metaVal = "(missingMetaData)";
            else
                metaVal = metaRow[metaIndex];
            metaCounts[metaVal] = 1 + (metaCounts[metaVal] || 0);
        }

        if (keys(metaCounts).length > 100) {
            warn("Cannot color on a field that has more than 100 different values");
            return null;
        }

        var oldSortBy = cartGet("SORT", legend.fieldName);
        if (sortBy===undefined && oldSortBy!==undefined)
            sortBy = oldSortBy;

        // sort like numbers if the strings are mostly numbers, otherwise sort like strings
        var sortResult = legendSort(metaCounts, sortBy);
        var countListSorted = sortResult.list;
        
        if (fieldName!==undefined)
            $("#tpLegendTitle").text(fieldName.replace(/_/g, " "));

        var fieldName = gCurrentDataset.metaFields[metaIndex];
        // force field names that look like "cluster" to a rainbow palette
        // even if they look like numbers
        if (fieldName.indexOf("luster") != -1 && sortBy===undefined)
            sortBy = "count";

        var defaultColors = makeColorPalette(countListSorted.length, sortResult.useGradient);

        var rows = [];
        for (i = 0; i < countListSorted.length; i++) {
            var count = countListSorted[i][0];
            var label = countListSorted[i][1];
            var color = defaultColors[i];
            var uniqueKey = fieldName+"|"+label;
            var colorMapKey = label;
            if (likeEmptyString(label))
                color = cNullColor;

            rows.push( [ color, color, label, count, colorMapKey, uniqueKey] );
        }

        legend.rows = loadColors(rows);
        legend.isSortedByName = sortResult.isSortedByName;
        return legend;
    }

    function findCellIdsForLegendIds (cellIdToLegendId, legendIds, cellIds) {
    /* given a legendId, return an object with cellIds that are associated to a given class */
        if (cellIds==undefined)
            cellIds = {};
        for (var i = 0; i < legendIds.length; i++) {
            var legendId = legendIds[i];
            for (var cellId in cellIdToLegendId) {
                if (gClasses[cellId] == legendId)
                    cellIds[cellId] = true;
                }
        }
        return cellIds;
    }

    function selectCellsInRect (x1, y1, x2, y2) {
    /* given pixel coordinates, select the cellIds within the rectangle*/
    // XX This is not using a quad-tree, but should. It's very slow right now.
       var minX = Math.min(x1, x2);
       var maxX = Math.max(x1, x2);

       var minY = Math.min(y1, y2);
       var maxY = Math.max(y1, y2);

        var cellIds = {};
        for (var i = 0; i < pixelCoords.length; i++) {
            var coord = pixelCoords[i];
            var cellId = coord[0];
            var x = coord[1];
            var y = coord[2];
            if ((x >= minX) && (x <= maxX) && (y >= minY) && (y <= maxY))
                cellIds[cellId] = true;
        }

        gSelCellIds = cellIds;
        updateSelection();
    }

    function colorByMetaField(fieldId) {
    /* color by a meta field and rebuild/redraw everything */
        var legend = buildLegendForMeta(fieldId);
        if (legend==null)
            return;

        if (gCurrentDataset.metaFields!=null)
            $('#tpLegendTitle').text(legend.fieldName.replace(/_/g, " "));
        $('.tpMetaBox').removeClass('tpMetaSelect');
        $('.tpMetaValue').removeClass('tpMetaValueSelect');
        $('#tpMetaBox_'+fieldId).addClass('tpMetaSelect');
        $('#tpMeta_'+fieldId).addClass('tpMetaValueSelect');
        $('.tpGeneBarCell').removeClass('tpGeneBarCellSelected');

        gLegend = legend;
        drawLegend();
        gClasses = assignCellClasses();
    }

    function onMetaClick (event) {
    /* called when user clicks a meta data field or label */
        var fieldId = parseInt(event.target.id.split("_")[1]);
        if (isNaN(fieldId)) {
            // try up one level in the DOM tree
            fieldId = parseInt(event.target.parentElement.id.split("_")[1]);
        }
        //gSelCellIds = {};
        colorByMetaField(fieldId);
        plotDots();
        renderer.render(stage);
        pushState({"meta":fieldId, "gene":null});
    }

    function addMetaTipBar(htmls, valFrac, valStr) {
        /* add another bar to a simple histogram built from divs */
        htmls.push("<div>&nbsp;");
        htmls.push("<div class='tpMetaTipPerc'>"+(100*valFrac).toFixed(1)+"%</div>");
        htmls.push("<div class='tpMetaTipName'>"+valStr+"</div>");
        //htmls.push("<span class='tpMetaTipCount'>"+valCount+"</span>");
        var pxSize = (valFrac * metaTipWidth).toFixed(0);
        htmls.push("<div style='width:"+pxSize+"px' class='tpMetaTipBar'>&nbsp</div>");
        htmls.push("</div>");
    }

    function onMetaMouseOver (event) {
    /* called when user hovers over meta element: shows the histogram of selected values */
        var metaHist = gCurrentDataset.metaHist;
        if (metaHist===undefined)
            return;

        // mouseover over spans or divs will not find the id, so look at their parent, which is the main DIV
        var target = event.target;
        if (target.id==="")
            target = event.target.parentNode;
        if (target.id==="")
            target = event.target.parentNode;
        var targetId = target.id;

        var fieldId = parseInt(targetId.split("_")[1]);

        var valHist = metaHist[fieldId];
        var htmls = [];
        var otherCount = 0;
        var totalSum = 0;
        for (var i = 0; i < valHist.length; i++) {
            var valInfo  = valHist[i];
            var valCount = valInfo[0];
            var valFrac  = valInfo[1];
            var valStr   = valInfo[2];

            totalSum += valCount;
            // only show the top values, summarize everything else into "other"
            if (i > HISTOCOUNT) {
                otherCount += valCount;
                continue;
            }

            if (valStr==="")
                valStr = "<span style='color:indigo'>(empty)</span>";
            addMetaTipBar(htmls, valFrac, valStr);
        }

        if (otherCount!==0) {
            var otherFrac = (otherCount / totalSum);
            addMetaTipBar(htmls, otherFrac, "<span style='color:indigo'>(other)</span>");
        }
        
        $('#tpMetaTip').html(htmls.join(""));
        $('#tpMetaTip').css({top: event.target.offsetTop+"px", left: metaBarWidth+"px", width:metaTipWidth+"px"});
        $('#tpMetaTip').show();
    }

    function buildComboBox(htmls, id, entries, selIdx, placeholder, width) {
    /* make html for a combo box and add lines to htmls list */
        htmls.push('<select style="'+width+'px" id="'+id+'" data-placeholder="'+placeholder+'" class="tpCombo">');
        for (var i = 0; i < entries.length; i++) {
            var isSelStr = "";
            var entry = entries[i];
            if ((selIdx!==undefined && i===selIdx))
                isSelStr = " selected"
            htmls.push('<option value="'+entry[0]+'"'+isSelStr+'>'+entry[1]+'</option>');
        }
        htmls.push('</select>');
    }

    function loadCoordSet(coordIdx) {
        var coordUrl = gCurrentDataset.coordFiles[coordIdx].url;
        console.log("Loading coordinates from "+coordUrl);
        //var fullUrl = joinPaths([gCurrentDataset.baseUrl, coordUrl]);
        startLoadTsv("coords", coordUrl, loadCoordsFromTsv);
    }

    function onLayoutChange(ev, params) {
        /* user changed the layout in the combobox */
        var coordIdx = parseInt(params.selected);
        loadCoordSet(coordIdx);
        pushState({"layout":coordIdx, "zoom":null});
        gCurrentDataset.coordIdx = coordIdx;

        // remove the focus from the combo box
        removeFocus();
    }

    function onGeneChange(ev) {
        /* user changed the layout in the combobox */
        var geneSym = ev.target.value;
        pushState({"gene":geneSym, "meta":null});
        console.log("Loading "+geneSym);
        loadSingleGeneFromMatrix(geneSym);
        $(this).blur();
        // remove the focus from the combo box
        //removeFocus();
    }


    function onDatasetChange(ev, params) {
        /* user changed the dataset in the dropbox */
        var datasetIdx = parseInt(params.selected);
        loadOneDataset(datasetIdx);
        $(this).blur();
        removeFocus();
    }

    function buildLayoutCombo(htmls, files, id, width, left) {
        /* files is a list of elements with a shortLabel attribute. Build combobox for them. */
        htmls.push('<div class="tpToolBarItem" style="position:absolute;left:'+left+'px;top:'+toolBarComboTop+'px"><label for="'+id+'">Layout</label>');
        var entries = [];
        for (var i = 0; i < files.length; i++) {
            var coordFiles = files[i];
            var label = coordFiles.shortLabel;
            if (label===undefined)
                warn("Layout coordinate file "+i+" has no .shortLabel attribute")
            entries.push([i, label]);
        }
        buildComboBox(htmls, id, entries, 0, "Select a layout algorithm...", width);
        htmls.push('</div>');
    }

    function buildDatasetCombo(htmls, datasets, id, width, left) {
        /* datasets with a list of elements with a shortLabel attribute. Build combobox for them. */
        var top = toolBarComboTop;
        htmls.push('<div class="tpToolBarItem" style="position:absolute;width:150px;left:'+left+'px;top:'+top+'px"><label for="'+id+'">Dataset</label>');
        var entries = [];
        for (var i = 0; i < datasets.length; i++) {
            var dataset = datasets[i];
            var label = dataset.shortLabel;
            if (label===undefined)
                label = "Dataset "+i;
            entries.push([i, label]);
        }
        buildComboBox(htmls, id, entries, 0, "Select a dataset...", width);
        htmls.push('</div>');
    }

    function buildGeneCombo(htmls, id, left) {
        /* datasets with a list of elements with a shortLabel attribute. Build combobox for them. */
        htmls.push('<div class="tpToolBarItem" style="position:absolute;left:'+left+'px;top:'+toolBarComboTop+'px">');
        htmls.push('<label style="padding-right:5px" for="'+id+'">Color by gene</label>');
        htmls.push('<select style="width:120px" id="'+id+'" placeholder="search..." class="tpCombo">');
        htmls.push('</div>');
    }


    function activateCombobox(id, widthPx) {
        $('#'+id).chosen({
            inherit_select_classes : true,
            width : widthPx
        });
    }

    function geneComboSearch(query, callback) {
        /* called when the user types something into the gene box, returns matching gene symbols */
        if (!query.length) 
            return callback();

        var geneList = [];

        for (var geneSym in gCurrentDataset.matrixOffsets) {
            if (geneSym.toLowerCase().startsWith(query.toLowerCase()))
                geneList.push({"id":geneSym, "text":geneSym});
        }

        return callback(geneList);
    }

    function buildToolBar (datasetIdx) {
    /* add the tool bar with icons of tools */
        $("#tpToolBar").remove();
        $(document.body).append("<div id='tpToolBar' style='position:absolute;left:"+(metaBarWidth+metaBarMargin)+"px;top:"+menuBarHeight+"px'></div>");

        var htmls = [];
        htmls.push('<div id="tpIcons" style="display:inline-block">');
        htmls.push('<div class="btn-group" role="group" style="vertical-align:top">');
        htmls.push('<button data-placement="bottom" data-toggle="tooltip" title="Zoom-to-rectangle mode.<br>Keyboard: Windows/Command or z" id="tpIconModeZoom" class="ui-button tpIconButton" style="margin-right:0"><img src="img/zoom.png"></button>');
        htmls.push('<button data-placement="bottom" title="Move mode. Keyboard: Alt or m" id="tpIconModeMove" data-toggle="tooltip" class="ui-button tpIconButton" style="margin-right:0"><img src="img/move.png"></button>');
        htmls.push('<button data-placement="bottom" title="Select mode.<br>Keyboard: shift or s" id="tpIconModeSelect" class="ui-button tpIconButton" style="margin-right:0"><img src="img/select.png"></button>');
        htmls.push('</div>');

        htmls.push('&emsp;');
        //htmls.push('<button title="Zoom in" id="tpIconZoomIn" type="button" class="btn-small btn-outline-primary noPad"><i class="material-icons">zoom_in</i></button>');
        //htmls.push('<button title="Zoom out" id="tpIconZoomOut" type="button" class="btn-small btn-outline-primary noPad"><i class="material-icons">zoom_out</i></button>');
        htmls.push('<button title="Zoom to full, keyboard: space" data-placement="bottom" data-toggle="tooltip" id="tpZoom100Button" class="ui-button tpIconButton" style="margin-right:0"><img src="img/center.png"></button>');

        //htmls.push("&emsp;");
        buildDatasetCombo(htmls, gOptions.datasets, "tpDatasetCombo", 100, toolBarComboLeft);

        //htmls.push('<div class="btn-group" role="group" style="vertical-align:top">');
        //htmls.push('<button title="More info about this dataset" id="tpIconDatasetInfo" type="button" class="ui-button tpIconButton"><img title="More info about this dataset" src="img/info.png"></button>');
        //htmls.push('</div>');
        htmls.push('<img class="tpIconButton" id="tpIconDatasetInfo" data-placement="bottom" data-toggle="tooltip" title="More info about this dataset" src="img/info.png" style="height:18px;position:absolute;top:4px; left:'+(toolBarComboLeft+datasetComboWidth+60)+'px">');

        //htmls.push("&emsp;");
        buildLayoutCombo(htmls, gCurrentDataset.coordFiles, "tpLayoutCombo", 200, toolBarComboLeft+280);

        //htmls.push("&emsp;");
        buildGeneCombo(htmls, "tpGeneCombo", toolBarComboLeft+500);

        $("#tpToolBar").append(htmls.join(""));
        activateTooltip('.tpIconButton');

        $('#tpIconModeMove').click( function() { activateMode("move")} );
        $('#tpIconModeZoom').click( function() { activateMode("zoom")} );  
        $('#tpIconModeSelect').click( function() { activateMode("select")} );
        $('#tpIconDatasetInfo').click( function() { onOpenDatasetClick(gCurrentDataset.baseUrl)});

        $('#tpIconZoomIn').click( onZoomInClick );
        $('#tpIconZoomOut').click( onZoomOutClick );
        $('#tpIconZoom100').click( onZoom100Click );

        activateCombobox("tpDatasetCombo", datasetComboWidth);
        activateCombobox("tpLayoutCombo", layoutComboWidth);

        //$('#tpGeneCombo').select2({ placeholder : "Gene Symbol"}); // preliminary setup, real setup will be in updateToolbar()
        $('#tpGeneCombo').selectize({
                labelField : 'text',
                valueField : 'id',
                searchField : 'text',
                load : geneComboSearch
        });

        $('#tpDatasetCombo').change(onDatasetChange);
        // update the combobox, select the right dataset
        $("#tpDatasetCombo").val(datasetIdx).trigger("chosen:updated");
        $('#tpLayoutCombo').change(onLayoutChange);
        $('#tpGeneCombo').change(onGeneChange);
    }

    function metaFieldToLabel(fieldName) {
    /* convert the internal meta field string to the label shown in the UI. Fix underscores, _id, etc */
        if (fieldName==="_id")
            fieldName = capitalize(gSampleDesc)+" identifier";
        else
            fieldName = fieldName.replace(/_/g, " ");
        return fieldName;
    }

    function buildMetaBar () {
    /* add the left sidebar with the meta data fields */
        $("#tpMetaBar").remove();
        $(document.body).append("<div id='tpMetaBar' style='position:absolute;left:0px;top:"+(menuBarHeight)+"px;width:"+metaBarWidth+"px'></div>");

        var htmls = [];
        htmls.push("<div id='tpMetaTitle'>"+METABOXTITLE+"</div>");
        var metaFields = gCurrentDataset.metaFields;
        for (var i = 0; i < metaFields.length; i++) {
            var fieldName = metaFields[i];
            var greyFields = gCurrentDataset.inactiveFields;

            var isGrey = false;
            if (i===0)
                isGrey = true;
            if (greyFields!==undefined && greyFields.indexOf(fieldName)!==-1)
                isGrey = true;

            var addClass = "";
            var addTitle="";
            htmls.push("<div class='tpMetaBox' id='tpMetaBox_"+i+"'>");
            if (isGrey) {
                addClass=" tpMetaLabelGrey";
                addTitle=" title='This field contains too many different values. You cannot click it to color on it.'";
            }

            htmls.push("<div id='tpMetaLabel_"+i+"' class='tpMetaLabel"+addClass+"'"+addTitle+"></div>");
            htmls.push("<div class='tpMetaValue' style='width:"+(metaBarWidth-2*metaBarMargin)+"px' id='tpMeta_"+i+"'>&nbsp;</div></div>");
        }

        $(document.body).append("<div id='tpMetaTip'></div>");
        $("#tpMetaBar").append(htmls.join(""));
        clearMetaBar();

        $(".tpMetaLabel").click( onMetaClick );
        $(".tpMetaValue").click( onMetaClick );
        $(".tpMetaValue").mouseover( onMetaMouseOver );
        $(".tpMetaValue").mouseleave ( function() { $('#tpMetaTip').hide()} );
        
        // setup the right-click menu
        var menuItems = [{name: "Use as cluster label"},{name: "Copy field value to clipboard"}];
        var menuOpt = {
            selector: ".tpMetaBox",
            items: menuItems, 
            className: 'contextmenu-customwidth',
            callback: onMetaRightClick
        };
        $.contextMenu( menuOpt );
        // setup the tooltips
        //$('[title!=""]').tooltip();
    }

    function findMinMax(coords) {
    /* given list of (x,y) tuples, find min/max range of values */
        var minX = 9999999;
        var maxX = -9999999;
        var minY = 9999999;
        var maxY = -9999999;
 
        for (var i = 0; i < coords.length; i++) {
            var x = coords[i][1];
            var y = coords[i][2];
                
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        
        var ret = {};
        ret.minX = minX;
        ret.maxX = maxX;
        ret.minY = minY;
        ret.maxY = maxY;
        return ret;
    }
        
    function scaleData(coords) {
    /* scale list of  [cellId, x (float),y (float)] to integer pixels on screen and
     * return new list of (cellId, x, y). Take into account the current zoom range.  */
        var borderSize = 5;
        var winWidth = gWinInfo.width-(2*borderSize);
        var winHeight = gWinInfo.height-(2*borderSize);
        console.log("Starting coordinate scaling");

        var zoomRange = gCurrentDataset.zoomRange;
        var minX = zoomRange.minX;
        var maxX = zoomRange.maxX;
        var minY = zoomRange.minY;
        var maxY = zoomRange.maxY;
        
        var spanX = maxX - minX;
        var spanY = maxY - minY;

        // transform from data floats to screen pixel coordinates
        var newCoords = [];
        for (var i = 0; i < coords.length; i++) {
            var cellId = coords[i][0];
            var x = coords[i][coord1Idx];
            var y = coords[i][coord2Idx];
            // XX ignore anything outside of current zoom range. Performance! Quad-tree?
            if ((x < minX) || (x > maxX) || (y < minY) || (y > maxY))
                continue;
            var newX = Math.round(((x-minX)/spanX)*winWidth)+borderSize;
            var newY = Math.round(((y-minY)/spanY)*winHeight)+borderSize;
            var newRow = [cellId, newX, newY];
            newCoords.push(newRow);
        }
        console.log("Coordinate scaling done");
        //gClusterMids = null; // make sure the cluster midpoints get re-calculated
        return newCoords;
    }

    function drawCircle(x, y, fill, line) {
    /* create a circle object */
       var c = new PIXI.Graphics();
       c.beginFill(fill);
       if (line != undefined)
           c.lineStyle(1, line, 1);
       c.drawCircle(x, y, circleSize);
       c.endFill();
       return c;
    }

    function drawRect(x, y, fill) {
    /* create a rectangle object */
       var rect = new PIXI.Graphics();
       rect.beginFill(fill);
       //rect.lineStyle(4, 0xFF3300, 1);
       rect.drawRect(x, y, dotWidth, dotHeight);
       rect.endFill();
       return rect;
    }

    function showIntro(addFirst) {
        /* add the intro.js data */
        //var htmls = [];
        //htmls.push("<a href='http://example.com/' data-intro='Hello step one!'></a>");
        //$(document.body).append(htmls.join(""));

        localStorage.setItem("introShown", "true");
        var intro = introJs();
        intro.setOption("hintAnimation", false);
        if (addFirst)
            intro.addStep({
                element: document.querySelector('#tpHelpButton'),
                intro: "Are you here for the first time and wondering what this is?<br>The tutorial takes only 1 minute. To skip the tutorial now, click 'Skip'.<br>You can always show it again by clicking 'Tutorial'.",
              });

        intro.addSteps(
            [
              {
                intro: "You can see a scatter plot of circles in the middle of the screen. Each circle is a "+gSampleDesc+".",
              },
              {
                element: document.querySelector('#tpMetaBar'),
                intro: "Meta data: when you move the mouse over a circle, its meta data fields will be shown here.<br>Click on a field to color the circles by the values of a field.<br>Right-click to select a field for the text labels.",
                position: 'right'
              },
              {
                element: document.querySelector('#tpGeneBar'),
                intro: "Expression data: when you move the mouse, expression values will be shown here.<br>Click on a gene to color the circles by gene expression level (log'ed).",
                position: 'top'
              },
              {
                element: document.querySelector('#tpLegendBar'),
                intro: "The legend shows the mapping from colors to meta or gene expression values.<br>Click on a color to change it.<br>Right-click to hide or show-only "+gSampleDesc+"s with certain values.<br>Click on the legend text to highlight "+gSampleDesc+"s with this value.",
                position: 'left'
              },
            ]);
        intro.start();
    }

    function oneFileLoaded(name) {
        /* increase file loaded counter, if at 3, call the init function */
        var status = gCurrentDataset.loadStatus;
        if ( (status["meta"]==="ok" && status["coords"]==="ok")
                && (status["offsets"]==="ok" || status["offsets"]==="error")
                && (status["colors"]==="ok" || status["colors"]==="error") )
        {
            if (status["preload"]==="error")
                gCurrentDataset.preloadExpr = null;
            if (status["offsets"]==="error")
                gCurrentDataset.matrixOffsets = null;
            initInfoBarsAndPlot();
        }
    }

    //function loadMetaFromJson(jsonDict) {
    ///* accepts dict with 'meta', loads into global var 'meta' */
        //gCurrentDataset.metaData = jsonDict.meta;
        //oneFileLoaded("meta");
    //}

    function loadMetaFromTsv(papaResults) {
    /* accepts dict with 'meta', loads into global var 'meta' */
        var rows = papaResults.data;
        var headerRow = rows[0];
        console.log(headerRow);
        //if (headerRow[0]!=="meta") {
            //warn("first field in meta.tsv is not 'meta'");
            //return;
        //}
        gCurrentDataset.metaFields = headerRow;

        var metaData = {};
        for (var i = 1; i < rows.length; i++) {
            var row = rows[i];
            var cellId = row[0];
            if (cellId==="")
                continue;
            metaData[cellId] = row;
        }
        gCurrentDataset.metaData = metaData;
        oneFileLoaded("meta");
    }

    function makeColorPalette(n, isGradient) {
    /* return an array with n color hex strings */
    // Use Google's palette functions for now, first Paul Tol's colors, if that fails, use the usual HSV rainbow
    if (!isGradient) {
        if (n<30)
            return iWantHue(n);
        else
            return palette(["tol", "rainbow"], n);
    }
    else
        return palette(["tol-sq"], n);
    }

    function setZoomRange() {
        /* find range of data and set variables related to it */
        gCurrentDataset.zoomFullRange = findMinMax(allCoords);
        var zoomRange = getZoomRangeFromUrl();
        if (zoomRange===null)
            zoomRange = cloneObj(gCurrentDataset.zoomFullRange)
        gCurrentDataset.zoomRange = zoomRange;
    }

    function scaleDataAndColorByCluster() {
    /* called when meta and coordinates have been loaded: scale data and color by meta field  */
        setZoomRange();
        shownCoords = allCoords.slice(); // most likely faster to copy and modify than build a new list
        pixelCoords = scaleData(shownCoords);

        var clusterFieldName = gCurrentDataset.clusterField;

        if (clusterFieldName===undefined) {
            gCurrentDataset.labelField = null;
            gCurrentDataset.showLabels = false;
            gClusterMids = null; // force recalc
            colorByMetaField(0);
        }
        else {
            var clusterFieldIdx = gCurrentDataset.metaFields.indexOf(clusterFieldName);
            if (clusterFieldIdx===undefined || clusterFieldIdx==-1)
                warn("Internal error: cluster label field (option 'clusterField') "+clusterFieldName+" is not a valid field");

            // also auto-activate cluster labels if labels are not configured at all
            if (gCurrentDataset.labelField===undefined && clusterFieldName!==undefined) {
                gCurrentDataset.labelField = clusterFieldName;
                gCurrentDataset.showLabels = true;
            }

            gClusterMids = null; // force recalc
            colorByMetaField(clusterFieldIdx);
        }

        var introShownBefore = localStorage.getItem("introShown");
        if (introShownBefore==undefined)
            setTimeout(function(){ showIntro(true); }, 3000); // first show user the UI and let them think 3 secs
    }

    function initInfoBarsAndPlot() {
        /* setup all the basic DIVs and listeners of the UI */
        // check that the label field is a valid field
        console.log("init UI");
        if (gCurrentDataset.labelField!==undefined) {
            gCurrentDataset.labelIndex = gCurrentDataset.metaFields.indexOf(gCurrentDataset.labelField);
            if (gCurrentDataset.showLabels === undefined)
                gCurrentDataset.showLabels = true;
            if (gCurrentDataset.labelIndex==undefined) {
                warn("The labelField "+gCurrentDataset.labelField+"is not a valid field in meta.tsv. Deactivating labels now.");
                gCurrentDataset.labelIndex = null;
                gCurrentDataset.showLabels = false;
            } 
        }
        buildMetaBar();
        scaleDataAndColorByCluster();
        buildGeneBar();
        resizeRenderer();

        plotDots();
        renderer.render(stage);
        updateMenu();
        updateToolbar();
        activateMode("zoom");
    }

    //function loadCoordsFromJson(jsonDict) {
    /* accepts dict with 'shownCoords' loads into global var 'coords' */
        //coords = jsonDict["seuratCoords"];
        //allCoords = coords;
    //}

    function loadColorsFromTsv(papaResults) {
    /* load tsv with key/val into gCurrentDataset.metaColors */
        console.log("got colors");
        var rows = papaResults.data;
        var nameToColor = {};
        for (var i = 1; i < rows.length; i++) {
            var row = rows[i];
            var name = row[0];
            var hex = row[1];
            nameToColor[name] = hex;
        }
        gCurrentDataset.metaColors = nameToColor;
        oneFileLoaded("colors");
    }

    function loadAcronymsFromTsv(papaResults) {
    /* load a tab sep file with key/value into gCurrentDataset */
        console.log("trying to load acronyms");
        var rows = papaResults.data;
        var acronymToText = {};
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var key = row[0];
            var val = row[1];
            acronymToText[key] = val;
        }
        gCurrentDataset.acronyms = acronymToText;
        oneFileLoaded("acronyms");
    }

    function loadCoordsFromTsv(papaResults) {
    /* accepts dict with 'shownCoords' loads into global var 'coords' */
        console.log("got coordinate TSV rows, parsing...");
        var rows = papaResults.data;
        var headerRow = rows[0];
        if (headerRow[0]!=="cellId" || headerRow[1]!=="x" || headerRow[2]!=="y") {
            warn("Coordinate file does not start with header line (cellId, x, y)");
            return;
        }

        allCoords = []
        for (var i = 1; i < rows.length; i++) {
            var row = rows[i];
            if (row[0]==="")
                continue;
            var x = parseFloat(row[1]);
            var y = parseFloat(row[2]);
            if (x!==x || y!==y) {
                warn("Row "+i+" of coordinate file contains a value that is not a number:"+JSON.stringify(row)+". Parsing stopped.");
                break;
            }
            allCoords.push([row[0], x, y]);
        }
        shownCoords = cloneArray(allCoords);
        //oneFileLoaded("coords");
        setZoomRange();
        pixelCoords = scaleData(shownCoords);
        gClusterMids = null;
        plotDots();
        renderer.render(stage);
    }

    //function loadPcaCoords(jsonDict) {
    /* accepts dict with 'shownCoords' loads into global var 'pcaCoords' */
        //pcaCoords = jsonDict["pcaCoords"];
    //}

    function geneExprDone(jsonDict) {
    /* pre-loaded genes: accepts dict with 'geneExpr' : cellId : array of floats */
        console.log("Got preloaded gene expression");
        gCurrentDataset.preloadExpr = jsonDict;
        resizeRenderer();
        oneFileLoaded("expr");
    }

    //function loadExprFromTsv(papaResults) {
    ///* load small-ish cell-on-rows matrix fully into RAM */
    //    console.log(papaResults);
    //    var rows = papaResults.data;
    //    var headerRow = rows[0];
    //    console.log(headerRow);

    //    // parse geneIds from the header line
    //    var geneFields = [];
    //    var geneIds = [];
    //    for (var i = 1; i < headerRow.length; i++) {
    //        var geneStr = headerRow[i];
    //        var parts = geneStr.split("|");
    //        var geneId = parts[0];
    //        geneIds.push(geneId);
    //        if (parts.length===3)
    //            geneFields.push(parts);
    //        else if (parts.length===1)
    //            geneFields.push([geneId, "Not def.", "Not def."]);
    //    }

    //    // parse expr vectors from matrix
    //    var geneCount = geneIds.length;
    //    var cellCount = rows.length - 1 ;

    //    // build array geneIdx -> array of float, for decile calc later on
    //    //var geneToExpr = [];
    //    //for (var i = 1; i < geneIds.length; i++) {
    //        //geneToExpr.push( Float32Array(cellCount) );
    //    //}

    //    // build decile dict: geneId -> array of 11 floats
    //    var deciles = {};
    //    for (var i = 1; i < geneIds.length; i++) {
    //        deciles.push( Float32Array(11) );
    //    }

    //    // parse all lines
    //    var cellToExpr = {};
    //    var decileIdx = 0;
    //    for (var rowIdx = 1; rowIdx < rows.length; rowIdx++) {
    //        var row = rows[rowIdx];
    //        var cellIdx = rowIdx-1;
    //        var cellId = row[0];
    //        var cellVec = Float32Array(geneCount);
    //        //if (cellId==="")
    //            //continue;
    //        for (var geneIdx = 1; geneIdx < row.length; geneIdx++) {
    //            val = parseFloat(row[geneIdx]);
    //            cellVec[geneIdx-1] = val;
    //            //geneToExpr[geneIdx-1][cellIdx] = val;
    //        }
    //        if (!cellId.startsWith("_decile"))
    //            cellToExpr[cellId] = cellVec;
    //        else
    //            for (var i=0; i<geneIds.length; i++) {
    //                deciles[geneIds[i]][decileIdx]
    //            }


    //            //if (val!==val) 
    //                //warn("Row "+i+" of coordinate file contains a value that is not a number:"+val);
    //    }
    //    //coords = jsonDict["seuratCoords"];
    //    //allCoords = seuratCoords;
    //    gCurrentDataset.preloadExpr.genes = geneFields;
    //    gCurrentDataset.preloadExpr.cellExpr = cellToExpr;
    //    oneFileLoaded();
    //}
    function geneIndexLoadDone(jsonDict) {
        /* called when the matrix index is loaded */
        gCurrentDataset.matrixOffsets = jsonDict;
        oneFileLoaded();
    }

    function startLoadJson(fileType, path, func, showError) {
    /* load a json file relative to baseUrl and call a function when done */
    var fullUrl = joinPaths([gCurrentDataset.baseUrl, path]);
    jQuery.getJSON(fullUrl, 
        function(data) { 
            gCurrentDataset.loadStatus[fileType] = "ok";
            func(data); 
        }).fail(function() {  // weird syntax
            if (showError) {
                warn("Could not load JSON file "+fullUrl);
                if (fileType==="preload")
                    resizeRenderer(); // immediately adapt the height/size of the drawing canvas
            } else {
                gCurrentDataset.loadStatus[fileType] = "error";
            }
        });
    }

    function startLoadTsv(fileType, path, func, addInfo) {
    /* load a tsv file relative to baseUrl and call a function when done */
    var fullUrl = joinPaths([gCurrentDataset.baseUrl,path]);
    console.time(fileType+" starting TSV parse");
    Papa.parse(fullUrl, {
            download: true,
            complete: function(results, localFile) {
                        gCurrentDataset.loadStatus[fileType] = "ok";
                        func(results, localFile, addInfo);
                    },
            error: function(err, file) {
                        gCurrentDataset.loadStatus[fileType] = "error";
                        if (addInfo!==undefined)
                            alert("could not load "+path);
                    }
            });
    }

    function removeFocus() {
    /* called when the escape key is pressed, removes current focus and puts focus to nothing */
        window.focus(); 
        if (document.activeElement) {
                document.activeElement.blur();
        }

    }

    function stopZoom() {
    /* called when the escape key is pressed */
        mouseDownX = null;
        mouseDownY = null;
        $("#tpSelectBox").hide();
    }


    function setupKeyboard() {
    /* bind the keyboard shortcut keys */
        Mousetrap.bind('o', onOpenDatasetClick);
        Mousetrap.bind('c m', onMarkClearClick);
        Mousetrap.bind('h m', onMarkClick);

        Mousetrap.bind('space', onZoom100Click);

        Mousetrap.bind('z', function() { activateMode("zoom"); });
        Mousetrap.bind('m', function() { activateMode("move"); });
        Mousetrap.bind('s', function() { activateMode("select"); });

        Mousetrap.bind('-', onZoomOutClick);
        Mousetrap.bind('+', onZoomInClick);
        Mousetrap.bind('n', onSelectNoneClick);
        Mousetrap.bind('a', onSelectAllClick);
        Mousetrap.bind('d', function() {$('#tpDatasetCombo').trigger("chosen:open"); return false;});
        Mousetrap.bind('l', function() {$('#tpLayoutCombo').trigger("chosen:open"); return false;});
        Mousetrap.bind('g', function() {$("#tpGeneCombo").selectize()[0].selectize.focus(); return false;});
        Mousetrap.bind('c l', onHideShowLabelsClick );

        $(document).keyup(function(e) { if (e.keyCode == 27) stopZoom(); });

    }


    // https://stackoverflow.com/a/33861088/233871
    function isInt(x) {
        return (typeof x==='number') && x % 1 == 0;
    }

    function naturalSort (a, b) {
    /* copied from https://github.com/Bill4Time/javascript-natural-sort/blob/master/naturalSort.js */
    "use strict";
    var re = /(^([+\-]?(?:0|[1-9]\d*)(?:\.\d*)?(?:[eE][+\-]?\d+)?)?$|^0x[0-9a-f]+$|\d+)/gi,
        sre = /(^[ ]*|[ ]*$)/g,
        dre = /(^([\w ]+,?[\w ]+)?[\w ]+,?[\w ]+\d+:\d+(:\d+)?[\w ]?|^\d{1,4}[\/\-]\d{1,4}[\/\-]\d{1,4}|^\w+, \w+ \d+, \d{4})/,
        hre = /^0x[0-9a-f]+$/i,
        ore = /^0/,
        i = function(s) { return naturalSort.insensitive && ('' + s).toLowerCase() || '' + s; },
        // convert all to strings strip whitespace
        x = i(a).replace(sre, '') || '',
        y = i(b).replace(sre, '') || '',
        // chunk/tokenize
        xN = x.replace(re, '\0$1\0').replace(/\0$/,'').replace(/^\0/,'').split('\0'),
        yN = y.replace(re, '\0$1\0').replace(/\0$/,'').replace(/^\0/,'').split('\0'),
        // numeric, hex or date detection
        xD = parseInt(x.match(hre), 16) || (xN.length !== 1 && x.match(dre) && Date.parse(x)),
        yD = parseInt(y.match(hre), 16) || xD && y.match(dre) && Date.parse(y) || null,
        oFxNcL, oFyNcL;
    // first try and sort Hex codes or Dates
    if (yD) {
        if ( xD < yD ) { return -1; }
        else if ( xD > yD ) { return 1; }
    }
    // natural sorting through split numeric strings and default strings
    for(var cLoc=0, numS=Math.max(xN.length, yN.length); cLoc < numS; cLoc++) {
        // find floats not starting with '0', string or 0 if not defined (Clint Priest)
        oFxNcL = !(xN[cLoc] || '').match(ore) && parseFloat(xN[cLoc]) || xN[cLoc] || 0;
        oFyNcL = !(yN[cLoc] || '').match(ore) && parseFloat(yN[cLoc]) || yN[cLoc] || 0;
        // handle numeric vs string comparison - number < string - (Kyle Adams)
        if (isNaN(oFxNcL) !== isNaN(oFyNcL)) { return (isNaN(oFxNcL)) ? 1 : -1; }
        // rely on string comparison if different types - i.e. '02' < 2 != '02' < '2'
        else if (typeof oFxNcL !== typeof oFyNcL) {
            oFxNcL += '';
            oFyNcL += '';
        }
        if (oFxNcL < oFyNcL) { return -1; }
        if (oFxNcL > oFyNcL) { return 1; }
    }
    return 0;
};

    function legendSort(dict, sortBy) {
    /* return a dictionary as reverse-sorted list (count, fieldValue).
    If there are more than 4 entries and all but one key are numbers, 
    sorts by key instead.
    */
        // convert the dict to a list of (count, key)
        var countList = [];
        var numCount = 0;
        var count = null;
        var useGradient = false; // use a rainbow or gradient palette?
        for (var key in dict) {
            count = dict[key];
            if (!isNaN(key)) // key looks like a number
                numCount++;
            countList.push( [count, key] );
        }

        // auto-detect: sort list by name if most names are numbers
        if ((countList.length >= 4 && numCount >= countList.length-1)) {
            if (sortBy===undefined)
                sortBy = "name";
            useGradient = true;
        }

        var isSortedByName = null;

        if (sortBy==="name") {
            countList.sort(function(a, b) { return naturalSort(a[1], b[1]); });  // I have a feeling that this is very slow...
            isSortedByName = true;
        }
        else {
            // sort this list by count
            countList = countList.sort(function(a, b){ return b[0] - a[0]; }); // reverse-sort by count
            isSortedByName = false;
        }

        var ret = {};
        ret.list = countList;
        ret.isSortedByName = isSortedByName;
        ret.useGradient = useGradient;
        return ret;
    }

    function assignColors(fieldIdx, countList, doReset) {
    /* given an array of (count, value), assign a color to every value.
     Returns an dict of value : (color as integer, color as hex string without #) 
     Will check if user has a manually defined color for this field before and use it, if present.
     If doReset is true, will delete of manual definitions.
     */
    }

    function plotSelection(coords) {
    /* redraw block dots of current selection
       Redrawing makes sure that they are not hidden underneath others. 
    */
        for (var i = 0; i < coords.length; i++) {
            var x = coords[i][0];
            var y = coords[i][1];
            var fill = coords[i][2];
            var dot = drawCircle(x, y, fill, 0x000000);
            stage.addChild(dot);
            visibleGlyps.push(dot);
        }
    }

    function findDotsWithMeta(metaIdx, hlValue) {
    /* return array of cellIds with a given meta value */
        var metaData = gCurrentDataset.metaData;
        ret = [];
        for (var i = 0; i < pixelCoords.length; i++) {
            var cellId = pixelCoords[i][0];
            var x = pixelCoords[i][1];
            var y = pixelCoords[i][2];
            var metaRow = metaData[cellId];
            var metaVal = metaRow[metaIdx];
            if (metaVal === hlValue) {
                ret.push(cellId);
            }
        }
    }

    function removeCellIds(coords, cellIds) {
    /* remove all coords that are in an object of cellIds */
        var newCoords = [];
        for (var i = 0; i < coords.length; i++) {
            var coord = coords[i];
            var cellId = coord[0];
            if (!(cellId in cellIds))
                newCoords.push(coord);
        }
        return newCoords;
    }

    function showOnlyCellIds(coords, cellIds) {
    /* keep only coords that are in an object of cellIds */
        var newCoords = [];
        for (var i = 0; i < coords.length; i++) {
            var coord = coords[i];
            var cellId = coord[0];
            if (cellId in cellIds)
                newCoords.push(coord);
        }
        return newCoords;
    }

    function onLegendLabelClick(event) {
    /* called when user clicks on legend entry. updates gLegend and gSelCellIds */
        var legendId = parseInt(event.target.id.split("_")[1]);
        if (("lastClicked" in gLegend) && gLegend.lastClicked==legendId) {
            // user clicked the same entry as before: remove all highlights
            gLegend.lastClicked = null;
            gSelCellIds = {};
            $('#tpLegend_'+legendId).removeClass('tpLegendSelect');
            menuBarHide("#tpFilterButton");
            menuBarHide("#tpOnlySelectedButton");
            updateGeneBarColors([]);
        }
        else {
            var domEvent = event.originalEvent;
            if (!domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.metaKey) {
                gSelCellIds = {}; // remove highlight
                $('.tpLegend').removeClass('tpLegendSelect');
            }
            var metaVal = gLegend.rows[legendId][4];
            gSelCellIds = findCellIdsForLegendIds(gClasses, [legendId], gSelCellIds);
            menuBarShow("#tpFilterButton");
            menuBarShow("#tpOnlySelectedButton");
            $('#tpLegend_'+legendId).addClass('tpLegendSelect');
            gLegend.lastClicked=legendId;
            updateSelection();
            updateGeneBarColors(keys(gSelCellIds));
        }
        plotDots();
        renderer.render(stage);
    }

    function onResetColorsClick (ev) {
    /* reset all colors in legend to defaults */
        // clear localStorage
        var rows = gLegend.rows;
        for (var i = 0; i < rows.length; i++) {
            var colorHex = rows[i][0];
            var defColor = rows[i][1];
            gLegend.rows[i][0] = defColor;
            var saveKey = rows[i][5];
            localStorage.removeItem(saveKey);
        }
        
        drawLegend();
        updateGeneBarColors(null);
        plotDots();
        renderer.render(stage);
    }

    function onSortByClick (ev) {
    /* flip the current legend sorting */
        var sortBy = null;
        var nextSortBy = null;
        if (gLegend.isSortedByName) {
            sortBy = "freq.";
            nextSortBy = "name";
        }
        else {
            sortBy = "name";
            nextSortBy = "freq.";
        }
        cartSave("SORT", gLegend.fieldName, sortBy, gLegend.defaultSortBy);
        buildLegend(sortBy);
        drawLegend();
        jQuery("#tpSortBy").text("Sort by "+nextSortBy);
    }


    function onMetaRightClick (key, options) {
    /* user right-clicks on a meta field */
        var metaIdx = parseInt(options.$trigger[0].id.split("_")[1]);

        if (key==0) {
            gCurrentDataset.labelField = gCurrentDataset.metaFields[metaIdx];
            gClusterMids = null; // force recalc
            plotDots();
            renderer.render(stage);
            updateMenu();
        }
        else if (key==1) {
            copyToClipboard("#tpMeta_"+metaIdx);
            //$("textarea").select();
            //document.execCommand('copy');
            //console.log(val);
        }
            
    }

    function onLegendRightClick (key, options) {
    /* user right-clicks on a legend label */
        var selEls = $(".tpLegendSelect")
        var legendIds = [];
        for (var i = 0; i < selEls.length; i++) {
            var selEl = selEls[i];
            var legendId = parseInt(selEl.id.split("_")[1]);
            legendIds.push(legendId);
        }

        var cellIds = findCellIdsForLegendIds(gClasses, legendIds);
        var mode;
        if (key==0) // hide
            mode = "hide";
        else
            mode = "showOnly";
        filterCoordsAndUpdate(cellIds, mode);
    }

    function drawLegend(sortBy) {
    /* draws current legend as specified by gLegend.rows 
     * sortBy can be "name" or "count" or "undefined" (=auto-detect)
     * */
        if (gLegend.rows==undefined)
            return;

        $('#tpLegendContent').empty();

        var htmls = [];
        var colors = [];
        var rows = gLegend.rows;

        // add the "sort by" div
        var sortLabel = null;
        if (gLegend.isSortedByName===true)
            sortLabel = "Sort by freq." // add the link to sort by the other possibility
        else
            sortLabel = "Sort by name"

        htmls.push("<span id='tpResetColors' style='color: #888; cursor:pointer; font-size:13px'>Reset colors</span>&emsp;");
        htmls.push("<span id='tpSortBy' style='color: #888; cursor:pointer; font-size:13px'>"+sortLabel+"</span>");

        // get the sum of all, to calculate frequency
        var sum = 0;
        for (var i = 0; i < rows.length; i++) {
            var count = rows[i][3];
            sum += count;
        }

        var acronyms = gCurrentDataset.acronyms;
        if (acronyms===undefined)
            acronyms = {};

        for (var i = 0; i < rows.length; i++) {
            var colorHex = rows[i][0];
            var label = rows[i][2];
            var count = rows[i][3];
            var freq  = 100*count/sum;

            colors.push(colorHex); // save for later

            var labelClass = "tpLegendLabel";
            label = label.replace(/_/g, " ").replace(/'/g, "&#39;").trim();
            if (label==="") {
                label = "(empty)";
                labelClass += " tpGrey";
            }
            else if (likeEmptyString(label))
                labelClass += " tpGrey";

            var labelDesc = acronyms[label] || null;
            if (labelDesc===null) {
                // only show the full value on mouse over if the label is long, "" suppresses mouse over
                if (label.length > 20 || labelDesc===null)
                    labelDesc = label;
                else
                    labelDesc = "";
            }


            var classStr = "tpLegend";
            var line = "<div id='tpLegend_" +i+ "' class='" +classStr+ "'>";
            htmls.push(line);
            htmls.push("<input class='tpColorPicker' id='tpLegendColorPicker_"+i+"' />");

            htmls.push("<span class='"+labelClass+"' id='tpLegendLabel_"+i+"' data-placement='auto top' title='"+labelDesc+"'>");
            htmls.push(label);
            htmls.push("</span>");
            //htmls.push("<span class='tpLegendCount'>"+count+"</div>");
            var prec = 1;            
            if (freq<1)
                prec = 2;
            htmls.push("<span class='tpLegendCount' title='"+count+" of "+sum+"'>"+freq.toFixed(prec)+"%</div>");
            htmls.push("</span>");

            htmls.push("</div>");
            //htmls.push("<input class='tpLegendCheckbox' id='tpLegendCheckbox_"+i+"' type='checkbox' checked style='float:right; margin-right: 5px'>");
        }


        var htmlStr = htmls.join("");
        $('#tpLegendContent').append(htmlStr);
        $('.tpLegend').click( onLegendLabelClick );
        //$('.tpLegendLabel').attr( "title", "Click to select samples with this value. Shift click to select multiple values.");
        $('#tpResetColors').click( onResetColorsClick );
        $('#tpSortBy').click( onSortByClick );
        activateTooltip(".tpLegendLabel");
        activateTooltip(".tpLegendCount");

        // setup the right-click menu
        var menuItems = [{name: "Hide "+gSampleDesc+"s with this value"}, {name:"Show only "+gSampleDesc+"s with this value"}];
        var menuOpt = {
            selector: ".tpLegend",
            items: menuItems, 
            className: 'contextmenu-customwidth',
            callback: onLegendRightClick 
        };
        $.contextMenu( menuOpt );

        // activate the color pickers
        for (var i = 0; i < colors.length; i++) {
            var opt = {
                hideAfterPaletteSelect : true,
                color : colors[i],
                showPalette: true,
                allowEmpty : true,
                showInput: true,
                preferredFormat: "hex",
                change: onColorPickerChange
                }
            $("#tpLegendColorPicker_"+i).spectrum(opt);
        }

        //$('#tpLegendTabs').tabs();
        $('#tpLegendTabs > ul').hide();
    }

    function onColorPickerChange(color) {
        /* called when user manually selects a color in the legend with the color picker */
        var rows = gLegend.rows;
        for (var i = 0; i < rows.length; i++) {
            var oldColorHex = rows[i][0];
            var defColorHex = rows[i][1];
            var newCol = $("#tpLegendColorPicker_"+i).spectrum("get");
            var newColHex = null;
            if (newCol==null)
                newColHex = oldColorHex.toHex();
            else
                newColHex = newCol.toHex();
            rows[i][0] = newColHex;

            // delete from storage if not needed anymore
            var saveKey = rows[i][5];
            if (newColHex == defColorHex)
                localStorage.removeItem(saveKey);
            else {
                // save the new color to localStorage
                localStorage.setItem(saveKey, newColHex);
                }
        }

        plotDots();
        renderer.render(stage);
        updateGeneBarColors(null);
    }

    function updateGeneBarColors(cellIds) {
    /* change the colors of the bottom gene bar to reflect the expression in cellIds */
        if (gCurrentDataset.preloadExpr===null)
            return;
        var cellExpr = gCurrentDataset.preloadExpr.cellExpr;
        var geneFields = gCurrentDataset.preloadExpr.genes;
        if (cellExpr===null || geneFields===null)
            return;

        if (cellIds===null)
            cellIds = gGeneBarCells;
        else
            gGeneBarCells = cellIds;
        // translate the gene expression values to intensities
        var deciles = gCurrentDataset.preloadExpr.deciles;
        var geneCount = geneFields.length;
        var intensities = newArray(geneCount, 0);

        // as we compare across genes, we can only average the intensities, not the values
        for (var i = 0; i < cellIds.length; i++) {
            var cellId = cellIds[i];
            var exprRow = cellExpr[cellId];
            for (var j = 0; j < geneCount; j++) {
                var val = exprRow[j];
                if (val != null) {
                    var geneId = geneFields[j][0];
                    var decileRanges = deciles[geneId];
                    if (decileRanges==undefined) {
                        //console.log("Warning: No decile in json file for "+geneId);
                        continue;
                    }
                    var binIdx = findBin(decileRanges, val);
                    intensities[j] += binIdx;
                }
            }
        }

        // use the average binIdx for each gene
        if (cellIds.length !== 0)
            for (var i = 0; i < intensities.length; i++) {
                intensities[i] = Math.round(intensities[i] / cellIds.length);
            }

            
        if (gDecileColors === null)
            gDecileColors = makeColorPalette(10, true);

        // get the colors from the current legend
        var nullColor = cNullColor;
        var colors = gDecileColors.slice();
        // if right now coloring by expression, the user may have defined colors manually
        if (gLegend.type=="gene") {
            nullColor = gLegend.rows[0][0];
            var rows = gLegend.rows;
            for (var i = 1; i < rows.length; i++)
                colors[i-1] = rows[i][0];
        }

        // use the average intensities to pick the colors
        var exprVals = null;
        if (cellIds.length === 1)
            exprVals = cellExpr[cellIds[0]];

        for (var i = 0; i < geneFields.length; i++) {
            var fieldName = "#tpGeneBarCell_"+i;
            var foreColor = "black";
            var binIdx = intensities[i];
            var backColor;
            if (binIdx==0) {
                backColor = nullColor;
                foreColor = cNullForeground;
            }
            else
                backColor = colors[binIdx-0];

            if (binIdx >= 6)
                foreColor = "white";
            var cellEl = $(fieldName);
            cellEl.css("background-color", "#"+backColor);
            cellEl.css("color", foreColor);

            // Put the current expression value into a special attribute, 
            // if a single cell is selected
            var exprVal = 0;
            if (cellIds.length === 1)
                exprVal = exprVals[i];
            cellEl.attr("data-value", exprVal)
        }
    }

    function countValues(arr) {
        /* count values in array, return an array of [value, count], sorted by count */
        // first make a list of all possible meta values and their counts
        var metaData = gCurrentDataset.metaData;
        var metaCounts = {};
        for (var i = 0; i < pixelCoords.length; i++) {
            var cellId = pixelCoords[i][0];
            var metaRow = metaData[cellId];
            var metaVal = metaRow[metaIndex];
            metaCounts[metaVal] = 1 + (metaCounts[metaVal] || 0);
        }

        var counts = {};
        for (var i = 0; i < arr.length; i++) {
            var val = arr[i];
            counts[val] = (counts[num] || 0) + 1;
            var metaVal = metaRow[metaIndex];
        }
    }

    function updateMetaBarManyCells(cellIds) {
    /* update the meta fields on the left to reflect/summarize a list of cellIds */
        var metaFields = gCurrentDataset.metaFields;
        var metaData = gCurrentDataset.metaData;
        var cellCount = cellIds.length;
        $('#tpMetaTitle').text("Meta data of "+cellCount+" "+gSampleDesc+"s");

        // for every field...
        var metaHist = {};
        for (var metaIdx = 0; metaIdx < metaFields.length; metaIdx++) {
            var metaCounts = {};
            // make an object of value -> count in the cells
            for (var i = 0; i < cellCount; i++) {
                var cellId = cellIds[i];
                var metaVal = metaData[cellId][metaIdx];
                metaCounts[metaVal] = 1 + (metaCounts[metaVal] || 0);
            }
            // convert the object to an array (count, percent, value) and sort it by count
            var histoList = [];
            for (var key in metaCounts) {
                var count = metaCounts[key];
                var frac  = (count / cellCount);
                histoList.push( [count, frac, key] );
            }
            histoList = histoList.sort(function(a, b){ return b[0] - a[0]; }); // reverse-sort by count
            metaHist[metaIdx] = histoList;

            // make a quick list of the top values for the sparklines, ignore the rest
            var countList = [];
            var otherCount = 0;
            for (var i=0; i < histoList.length; i++) {
                var count = histoList[i][0];
                if (i<SPARKHISTOCOUNT)
                    countList.push(count);
                else
                    otherCount+=count;
            }
            if (otherCount!==0)
                countList.push(otherCount);

            // update the UI

            var topCount = histoList[0][0];
            var topPerc  = histoList[0][1];
            var topVal   = histoList[0][2];
            var percStr = (100*topPerc).toFixed(1)+"%";

            if (topVal.length > 14)
                topVal = topVal.substring(0, 14)+"...";

            var label = "";
            if (histoList.length!==1){
                if (histoList[0][0]===1)
                    label = "<span class='tpMetaMultiVal'>" + histoList.length + " unique values</span>";
                else
                //label = "<span class='tpMetaMultiVal'>" + histoList.length + " values</span><span class='tpMetaHistLabel'> Histogram </span>&nbsp;&nbsp;<span id='tpMetaSpark_"+metaIdx+"'></span>";
                //label = "<span class='tpMetaMultiVal'>" + histoList.length + " values</span>&nbsp;<span id='tpMetaSpark_"+metaIdx+"'></span>";
                label = "<span class='tpMetaMultiVal'>" + percStr + " " +topVal+"</span>&nbsp;<span class='tpMetaSpark' id='tpMetaSpark_"+metaIdx+"'></span>";
            }
            else
                label = topVal;

            $('#tpMeta_'+metaIdx).html(label);
            $('#tpMetaSpark_'+metaIdx).sparkline(countList, {type:"bar", barSpacing:0, disableTooltips:true});

            //var topCount = countList[0][0];
            //var topPerc  = countList[0][1];
            //var topVal   = countList[0][2];
            //$('#tpMeta_'+metaIdx).text(topVal);
            //var label = metaFieldToLabel(metaFields[metaIdx]);
            //$('#tpMetaLabel_'+metaIdx).html(label+"<span class='tpMetaPerc'>"+(100*topPerc).toFixed(1)+"%</span>");
        }
        gCurrentDataset.metaHist = metaHist;
    }

    function updateMetaBarOneCell(cellId) {
        // update the meta bar with meta data from a single cellId
        delete gCurrentDataset.metaHist;
        var metaData = gCurrentDataset.metaData;
        var cellInfo = metaData[cellId];
        var metaFields = gCurrentDataset.metaFields;
        $('#tpMetaTitle').text(METABOXTITLE);
        for (var i = 0; i < metaFields.length; i++) {
            var fieldName = metaFields[i];
            $('#tpMetaLabel_'+i).html(metaFieldToLabel(fieldName));
            var fieldValue = cellInfo[i];
            if (fieldValue.startsWith("http") && fieldValue.endsWith(".png")) {
                $('#tpMeta_'+i).css('height', "40px");
                $('#tpMeta_'+i).html("<img src='"+fieldValue+"'></img>");
            } else
                $('#tpMeta_'+i).html(fieldValue);
            $('#tpMeta_'+i).attr('title', cellInfo[i]);
        }

    }

    function onDotMouseOver (mouseData) {
        /* user hovers over a circle with the mouse */
        if (mouseDownX!=null) // user is currently zooming
            return;
        if (! (gSelCellIds===null || jQuery.isEmptyObject(gSelCellIds))) // some cells are selected
            return;
        var cellId = mouseData.target.cellId;
        this.alpha = 1.0;
        renderer.render(stage);
        //renderer.render(stage);

        updateMetaBarOneCell(cellId)
        updateGeneBarColors([cellId]);
    }

    function onDotMouseClick (event) {
        /* user clicks onto a circle with the mouse */
        console.log("click on dot");
        if (mouseDownX!=null) {// user is currently zooming
            console.log("click on dot: user is zooming, ignore");
            return;
        }
        dotClickX = event.data.global.x;
        dotClickY = event.data.global.y;
        mouseDownX = null;
        mouseDownY = null;

        var cellId = event.target.cellId;
        var domEvent = event.data.originalEvent;
        if (!domEvent.shiftKey && !domEvent.ctrlKey && !domEvent.metaKey)
            gSelCellIds = {};
        gSelCellIds[cellId] = true;
        //updateMetaBarOneCell(cellId)
        updateSelection();
        updateGeneBarColors([cellId]);
        plotDots();
        renderer.render(stage);
        event.stopPropagation();
    }

    function constructMarkerWindow(clusterName) {
        /* build and open the dialog with the marker genes table for a given cluster */
        console.log("building marker genes window for "+clusterName);
        var tabInfo = gCurrentDataset.markers; // list with (label, subdirectory)
        if (tabInfo===undefined)
            return;
        var doTabs = (tabInfo != undefined && tabInfo.length>1);

        var htmls = [];

        if (gCurrentDataset.hubUrl!==undefined)
            htmls.push("&nbsp;<a target=_blank class='link' href='http://genome.ucsc.edu/cgi-bin/hgTracks?hubUrl="+gCurrentDataset.hubUrl+"'>Show Sequencing Reads on UCSC Genome Browser</a><p>");

        if (doTabs) {
            htmls.push("<div id='tabs'>");
            htmls.push("<ul>");
            for (var tabIdx = 0; tabIdx < tabInfo.length; tabIdx++) {
                var tabLabel = tabInfo[tabIdx][1];
                htmls.push("<li><a href='#tabs-"+tabIdx+"'>"+tabLabel+"</a>");
            }
            htmls.push("</ul>");
        }

        for (var tabIdx = 0; tabIdx < tabInfo.length; tabIdx++) {
            var divName = "tabs-"+tabIdx;
            var tabDir = tabInfo[tabIdx][0];
            var markerTsvUrl = joinPaths([tabDir, clusterName.replace("/", "_")+".tsv"]);

            htmls.push("<div id='"+divName+"'>");
            htmls.push("Loading...");
            htmls.push("</div>");

            startLoadTsv("markers", markerTsvUrl, loadMarkersFromTsv, divName);
        }

        htmls.push("</div>"); // tabs

        var buttons = {
        "Download as file" :
            function() {
                //url = joinPaths([baseUrl,"geneMatrix.tsv"]);
                document.location.href = url;
            },
        };

        var winWidth = window.innerWidth - 0.10*window.innerWidth;
        var winHeight = window.innerHeight - 0.10*window.innerHeight;
        var title = "Cluster markers for &quot;"+clusterName+"&quot;";
        if (gCurrentDataset.acronyms!==undefined && clusterName in gCurrentDataset.acronyms)
            title += " - "+gCurrentDataset.acronyms[clusterName];
        showDialogBox(htmls, title, {width: winWidth, height:winHeight, "buttons":buttons});
        //$(".tpLoadGeneLink").on("click", onMarkerGeneClick);
        //activateTooltip(".link");
        $(".ui-widget-content").css("padding", "0");
        $("#tabs").tabs();
        removeFocus();

    }

    function onLabelClick (ev) {
        /* user clicks a text label */
        console.log("click on label");
        mouseDownX = null;
        mouseDownY = null;
        lastPanX = null;
        lastPanY = null;
        var clusterName = ev.target.labelText;
        console.log("click on label: "+clusterName);
        ev.stopPropagation();
        constructMarkerWindow(clusterName);
    }

    function geneListFormat(htmls, s, symbol) {
    /* transform a string in the format dbName|linkId|mouseOver;... to html and push these to the htmls array */
        var dbParts = s.split(";");
        for (var i = 0; i < dbParts.length; i++) {
            var dbPart = dbParts[i];
            var idParts = dbPart.split("|");

            var dbName = idParts[0];
            var linkId = null;
            var mouseOver = "";

            // linkId and mouseOver are optional
            if (idParts.length>1) {
                linkId = idParts[1];
            }
            if (idParts.length>2) {
                mouseOver = idParts[2];
            }

            var dbUrl = dbLinks[dbName];
            if (dbUrl===undefined)
                htmls.push(dbName);
            else {
                if (linkId==="" || linkId===null)
                    linkId = symbol;
                htmls.push("<a target=_blank title='"+mouseOver+"' data-placement='auto left' class='link' href='"+dbUrl+linkId+"'>"+dbName+"</a>");
            }

            if (i!==dbParts.length-1)
                htmls.push(", ");
        }
    }

    function onMarkerGeneClick(ev) {
        /* user clicks onto a gene in the table of the marker gene dialog window */
        var geneSym = ev.target.getAttribute("data-gene");
        $(".ui-dialog").remove(); // close marker dialog box
        loadSingleGeneFromMatrix(geneSym);
    }

    function loadMarkersFromTsv(papaResults, url, divId) {
        /* construct a table from a marker tsv file and write as html to the DIV with divID */
        console.log("got coordinate TSV rows, parsing...");
        var rows = papaResults.data;
        var headerRow = rows[0];

        var htmls = [];

        htmls.push("<table class='table'>");
        htmls.push("<thead>");
        var hprdCol = null;
        var geneListCol = null;
        var exprCol = null;
        for (var i = 1; i < headerRow.length; i++) {
            var colLabel = headerRow[i];
            var width = null;
            if (colLabel==="_geneLists") {
                colLabel = "Gene Lists";
                geneListCol = i;
            }
            else if (colLabel==="_expr") {
                colLabel = "Expression";
                exprCol = i;
            }
            else if (colLabel==="_hprdClass") {
                hprdCol = i;
                colLabel = "Protein Class (HPRD)";
                width = "100px";
            }

            if (width===null)
                htmls.push("<th>");
            else
                htmls.push("<th style='width:"+width+"'>");
            htmls.push(colLabel);
            htmls.push("</th>");
        }
        htmls.push("</thead>");

        htmls.push("<tbody>");
        for (var i = 1; i < rows.length; i++) {
            htmls.push("<tr>");
            var row = rows[i];
            var geneId = row[0];
            var geneSym = row[1];
            htmls.push("<td><a data-gene='"+geneSym+"' class='link tpLoadGeneLink'>"+geneSym+"</a></td>");

            for (var j = 2; j < row.length; j++) {
                var val = row[j];
                htmls.push("<td>");
                if (val.startsWith("./")) {
                    var imgUrl = val.replace("./", gCurrentDataset.baseUrl);
                    var imgHtml = '<img width="100px" src="'+imgUrl+'">';
                    val = "<a data-toggle='tooltip' data-placement='auto' class='tpPlots' target=_blank title='"+imgHtml+"' href='"+ imgUrl + "'>link</a>";
                }
                if (j===geneListCol || j===exprCol)
                    geneListFormat(htmls, val, geneSym);
                else
                    htmls.push(val);
                htmls.push("</td>");
            }
            htmls.push("</tr>");
        }

        htmls.push("</tbody>");
        htmls.push("</table>");

        $("#"+divId).html(htmls.join(""));
        $(".tpLoadGeneLink").on("click", onMarkerGeneClick);
        activateTooltip(".link");

        var ttOpt = {"html": true, "animation": false, "delay":{"show":100, "hide":100} }; 
        $(".tpPlots").bsTooltip(ttOpt);

        removeFocus();
    }

    function calcClusterMids(metaFieldIdx) {
        // arrange the current coordinates to format cluster -> array of coords
        var metaData = gCurrentDataset.metaData;
        var clusterCoords = {};
        for (var i = 0; i < allCoords.length; i++) {
            var cellId = allCoords[i][0];
            var x = allCoords[i][1];
            var y = allCoords[i][2];
            var meta = metaData[cellId];
            var clusterLabel = null;
            if (meta!==undefined)
                clusterLabel = meta[metaFieldIdx];
            else
                clusterLabel = "(missingMetaData)";

            if (clusterCoords[clusterLabel] == undefined)
                clusterCoords[clusterLabel] = [];
            clusterCoords[clusterLabel].push( [x, y] );
        }

        // for each cluster, calculate the midpoints of all coords and append to array as (label, x, y)
        gClusterMids = [];
        for (var label in clusterCoords) {
            var coords = clusterCoords[label];

            var xSum = 0;
            var ySum = 0;
            for (var i = 0; i < coords.length; i++) {
                xSum += coords[i][0];
                ySum += coords[i][1];
            }

            var dotCount = clusterCoords[label].length;
            var midX = Math.floor(xSum / dotCount);
            var midY = Math.floor(ySum / dotCount);
            gClusterMids.push( [label, midX, midY] );            
        }
    }

    function plotClusterLabels () {
    /* plot semi-transparent labels for clusters */
        var metaFieldIdx = gCurrentDataset.metaFields.indexOf(gCurrentDataset.labelField);

        if (metaFieldIdx === -1 || gCurrentDataset.showLabels === false)
            return;

        var metaData = gCurrentDataset.metaData;
        if (gClusterMids === null)
            calcClusterMids(metaFieldIdx);

        var txtStyle = {
            font : 'bold 13px Arial', 
            fill : 'black',
            stroke : '#ffffff',
            strokeThickness: 2,
            //dropShadow : true,
            //dropShadowColor : '#ffffff',
            //dropShadowDistance : 2,
        };
        var anchor = new PIXI.Point(0.5, 0.5); // center the text

        var clusterMidsPx = scaleData(gClusterMids);
        var oldCursor;
        for (var i = 0; i < clusterMidsPx.length; i++) {
            var mid = clusterMidsPx[i];
            var label = mid[0].replace(/_/g, " ");
            var midX = mid[1];
            var midY = mid[2];

            var t = new PIXI.Text(label, txtStyle);
            var sprite = new PIXI.Sprite(t.generateTexture(renderer));
            t.x = midX;
            t.y = midY;
            t.anchor = anchor;
            t.alpha=0.8;
            t.labelText=label;
            t.interactive = true;
            t.on('click', onLabelClick);
            t.on('mouseover', function(mouseData) {
                this.alpha = 1.0;
                renderer.render(stage);
                oldCursor = $('canvas').css('cursor');
                $('canvas').css('cursor','pointer');
            });
            t.on('mouseout', function(mouseData) {
                this.alpha = 0.8;
                renderer.render(stage);
                $('canvas').css('cursor',oldCursor);
            });
            stage.addChild(t);
            visibleGlyps.push(t);
        }
    }

    function plotMarkers(stage, markerCoords) {
        /* plot arrows at marker coords */
        var t = PIXI.Texture.fromImage("marker");
        //if (markerCoords.length > gMarkerSprites.children.length)
           //while (markerCoords.length > gMarkerSprites.children.length)
              //gMarkerSprites.addChild(new PIXI.Sprite(t));

        for (var i = 0; i < markerCoords.length; i++) {
            var pos = markerCoords[i];
            //var m = gMarkerSprites[i];
            var m = new PIXI.Sprite(t);
            m.x = pos[0];
            m.y = pos[1] - (2.5*circleSize);
            m.anchor.set(0.5);
            m.scale.set(1.5);
            stage.addChild(m);
            visibleGlyps.push(m);
        }
        //stage.addChild(gMarkerSprites);
    }

    function plotDots() {
        /* plot the data onto the canvas. colorByIndx is the index of the meta field to color on. */
        if (stage!=null)
            {
            console.time("clear");
            //stage.removeChild(gMarkerSprites); // don't destroy the markers
            var children = stage.children;
            for (var i = 0; i < children.length; i++) {
                children[i].destroy();
            }
            stage.destroy();
            //stage.destroy(true); // free all children in OpenGL's GPU memory
            console.timeEnd("clear");
            }

        // a stage is a collection of drawables
        stage = new PIXI.Container();
        //stage.addChild(gMarkerSprites);

       //var backgroundLayer = new PIXI.DisplayObjectContainer();
       var background = new PIXI.Graphics();
       background.beginFill(0x000000, 0.0);
       background.drawRect(0, 0, gWinInfo.width, gWinInfo.height);
       background.interactive = true;

       stage.addChild(background);

        // write grey cell/sample count in upper left corner
        var selCount = Object.keys(gSelCellIds).length;
        var hideCount = allCoords.length - shownCoords.length;

        var textLines = [];

        //textLines.push(gCurrentDataset.label)

        var countLine = pixelCoords.length + ' '+gSampleDesc+'s';
        if (hideCount!=0)
            countLine += " shown";
        textLines.push(countLine);

        if (selCount!=0)
            textLines.push(selCount+" selected");
        if (hideCount!=0)
            textLines.push(hideCount+" hidden");
        var topText = textLines.join("\n");

        var t = new PIXI.Text(topText, {'fontSize': '12px'});
        t.x = 1;
        t.y = 0;
        t.alpha=0.5;
        stage.addChild(t);

        var greyCol = parseInt("888888", 16);
        var classColors = null;

        if (gLegend!=null) {
            // need integer colors for pixi, one per legend row = bin
            classColors = {};
            var rows = gLegend.rows;
            for (var i = 0; i < rows.length; i++) {
                var colorInt = parseInt(rows[i][0], 16);
                classColors[i] = colorInt;
            }
        }

        var markedCellIds = null;
        if (gCurrentDataset.markedCellIds!==undefined)
            markedCellIds = gCurrentDataset.markedCellIds;

        var hlCoords = [];
        var markerCoords = [];
        console.time("drawing");

        visibleGlyps = [];
        for (var i = 0; i < pixelCoords.length; i++) {
            var cellId = pixelCoords[i][0];
            var x = pixelCoords[i][1];
            var y = pixelCoords[i][2];
            var fill = null;
            if (classColors==null) {
                fill = greyCol;
                }
            else
                {
                var gClass = gClasses[cellId];
                fill = classColors[gClass];
                }

            if (markedCellIds!=null && cellId in gCurrentDataset.markedCellIds)
                markerCoords.push([x, y]);

            if (cellId in gSelCellIds)
                {
                // don't draw selected cells now, keep them for later
                hlCoords.push([x, y, fill]);
                continue;
                }



            var dot = drawCircle(x, y, fill);
            dot.alpha = transparency;

            // setup mouse over 
            dot.interactive=true;
            // I'm making the hit area slightly larger, so easier to hit
            dot.hitArea = new PIXI.Rectangle(x-(circleSize/2-1), y-(circleSize/2)-1, circleSize+1, circleSize+1);
            dot.cellId = cellId;
            dot.on('mouseover', onDotMouseOver);
            dot.on('mouseout',  function(mouseData) {
               this.alpha = transparency;
               renderer.render(stage);
            });

            dot.on('mousedown', onDotMouseClick);
            stage.addChild(dot);
            visibleGlyps.push(dot); // XX wasteful: keeping a ref for panning, need to be refactored one day
        }
        
        // finally, draw the currently highlighted dots on top
        plotSelection(hlCoords);
        plotMarkers(stage, markerCoords);
        plotClusterLabels();

        console.timeEnd("drawing");
    }

    function setupMouseWheel() {
      $('canvas').on( 'DOMMouseScroll mousewheel', function ( event ) {
          var delta = event.originalEvent.wheelDelta;
          // event.originalEvent.detail > 0 || event.originalEvent.wheelDelta < 0 
          if (delta > 0) {
              //scroll down
              console.log('Down');
              zoom(-0.03);
          } else {
              //scroll up
              console.log('Up');
              zoom(0.03);
          }
      return false;
    });
    }

    var digitTest = /^\d+$/,
        keyBreaker = /([^\[\]]+)|(\[\])/g,
        plus = /\+/g,
        paramTest = /([^?#]*)(#.*)?$/;

    function deparam(params){
    /* https://github.com/jupiterjs/jquerymx/blob/master/lang/string/deparam/deparam.js */
        if(! params || ! paramTest.test(params) ) {
            return {};
        } 
       
    
        var data = {},
            pairs = params.split('&'),
            current;
            
        for(var i=0; i < pairs.length; i++){
            current = data;
            var pair = pairs[i].split('=');
            
            // if we find foo=1+1=2
            if(pair.length != 2) { 
                pair = [pair[0], pair.slice(1).join("=")]
            }
              
            var key = decodeURIComponent(pair[0].replace(plus, " ")), 
                value = decodeURIComponent(pair[1].replace(plus, " ")),
                parts = key.match(keyBreaker);
    
            for ( var j = 0; j < parts.length - 1; j++ ) {
                var part = parts[j];
                if (!current[part] ) {
                    // if what we are pointing to looks like an array
                    current[part] = digitTest.test(parts[j+1]) || parts[j+1] == "[]" ? [] : {}
                }
                current = current[part];
            }
            var lastPart = parts[parts.length - 1];
            if(lastPart == "[]"){
                current.push(value)
            }else{
                current[lastPart] = value;
            }
        }
        return data;
    }

    function pushState(vars) {
    /* push the variables (object) into the history as the current URL. key=null deletes a variable. */
       // first get the current variables from the current URL
       var myUrl = window.location.href;
       myUrl = myUrl.replace("#", "");
       var urlParts = myUrl.split("?");
       var baseUrl = urlParts[0];
       var queryStr = urlParts[1];
       var urlVars = deparam(queryStr); // parse key=val&... string to object

       // overwrite everthing that we got
       for (var key in vars) {
           var val = vars[key];
           if (val===null || val in urlVars)
               delete urlVars[key];
           else
               urlVars[key] = val;
       }

       var argStr = jQuery.param(urlVars); // convert to query-like string
       history.pushState({}, gCurrentDataset.shortLabel, baseUrl+"?"+argStr);
    }

    function getVar(name, defVal) {
        /* get query variable from current URL or default value if undefined */
       var myUrl = window.location.href;
       myUrl = myUrl.replace("#", "");
       var urlParts = myUrl.split("?");
       var queryStr = urlParts[1];
       var varDict = deparam(queryStr); // parse key=val&... string to object
       if (varDict[name]===undefined)
           return defVal;
       else
           return varDict[name];
    }

    function pushZoomState(zoomRange) {
        /* write the current zoom range to the URL. Null to remove it from the URL. */
       if (zoomRange===null)
            pushState({zoom:null});
       else
           pushState({zoom:zoomRange.minX.toFixed(5)+"_"+zoomRange.maxX.toFixed(5)+"_"+zoomRange.minY.toFixed(5)+"_"+zoomRange.maxY.toFixed(5)});
    }

    function getZoomRangeFromUrl() {
        /* return a zoomRange object based on current URL */
        var zoomStr = getVar("zoom", null);
        if (zoomStr===null)
            return null;
        var zs = zoomStr.split("_");
        if (zs.length!=4)
            return null;
        var zoomRange = {};
        zoomRange.minX = parseFloat(zs[0]);
        zoomRange.maxX = parseFloat(zs[1]);
        zoomRange.minY = parseFloat(zs[2]);
        zoomRange.maxY = parseFloat(zs[3]);
        return zoomRange;
    }

    function loadOneDataset(datasetIdx) {
        /* reset the view and load a whole new dataset */
        if (datasetIdx===undefined)
            datasetIdx = 0;

        gClusterMids = null;
        gSelCellIds = {};
        gCurrentCoordName = null;
        gLegend = null;
        gCurrentDataset = gOptions.datasets[datasetIdx];

        var coordFiles = gCurrentDataset.coordFiles;
        if (coordFiles===undefined)
            gCurrentDataset.coordFiles = [
                {shortLabel : "Seurat T-SNE", url : "seurat.coords.tsv"},
                {shortLabel : "T-ETE", url : "tete.coords.tsv"},
                {shortLabel : "Tumormap", url : "tumormap.coords.tsv"},
                {shortLabel : "PCA - PC1/2",  url : "pc12.coords.tsv"},
                {shortLabel : "PCA - PC2/3",  url : "pc23.coords.tsv"},
                {shortLabel : "PCA - PC3/4", url : "pc34.coords.tsv"},
                {shortLabel : "PCA - PC4/5", url : "pc45.coords.tsv"},
            ];

       buildToolBar(datasetIdx);

       var coordIdx = parseInt(getVar("layout", 0));
       // if the user has already selected a layout before in this dataset
       // reuse it now
       if (gCurrentDataset.coordIdx!==undefined)
           coordIdx = gCurrentDataset.coordIdx;

       if (coordIdx!=0)
           // update combobox
           $('#tpLayoutCombo').val(coordIdx).trigger('chosen:updated');
       var coord1Url = gCurrentDataset.coordFiles[coordIdx].url;
       if (coord1Url===undefined)
           warn("config error: the 'coordFiles' config list, element 0, does not have a 'url' attribute");

       gCurrentDataset.preloadExpr = {}; // until proven otherwise, assume that preloaded genes exist
       gCurrentDataset.loadStatus = {};

       startLoadTsv("colors", "colors.tsv", loadColorsFromTsv);
       startLoadTsv("meta", "meta.tsv", loadMetaFromTsv);
       startLoadTsv("coords", coord1Url, loadCoordsFromTsv);
       startLoadTsv("acronyms", "acronyms.tsv", loadAcronymsFromTsv);
       startLoadJson("offsets", "geneMatrixOffsets.json", geneIndexLoadDone, false ); // not a required file anymore
       startLoadJson("preload", "preloadGenes.json", geneExprDone, false ); // not a required file, so do not show error

       pushState({ds:gCurrentDataset.baseUrl.replace("/","")});
    }

    /* ==== MAIN ==== ENTRY FUNCTION */
    function loadData(opt, globalOpts) {
        /* start the JSON data loading, uses first dataset */

        // pre-load the marker image
        PIXI.loader.add("marker", "img/marker.png").load( function() { 
            var t = PIXI.Texture.fromImage("marker");
            PIXI.Texture.addToCache(t, "marker");
        });

        if (globalOpts!=undefined) {
            if ("sampleType" in globalOpts)
                gSampleDesc = globalOpts["sampleType"];
            if ("title" in globalOpts)
                gTitle = globalOpts["title"];
        }
            
        // if ds=xxx was found in the URL, search for this dataset
        var datasetIndex = 0;
        var dsUrl = getVar("ds", null);
        if (dsUrl!==null) {
            for (var i = 0; i < opt.datasets.length; i++) {
                var ds = opt.datasets[i];
                if (ds.baseUrl.replace(/\/$/, "")===dsUrl) {
                    datasetIndex = i;
                    break
                }
            }
        }
            

        gOptions = opt;
        drawMenuBar();
        setupKeyboard();
        gCurrentDataset = {};
        createRenderer();
        setupMouseWheel();
        drawLegendBar();
        loadOneDataset(datasetIndex);
        menuBarHide("#tpShowAllButton");
    }

    // only export these functions 
    return {
        "loadData":loadData
    }

}();

function _tpReset() {
/* for debugging: reset the intro setting */
    localStorage.removeItem("introShown");
}
