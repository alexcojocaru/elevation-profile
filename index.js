var heightgraphOptions = {
    mappings: {
        gradient: {
            "-5": {
                text: "< -16%",
                color: "#028306"
            },
            "-4": {
                text: "-10..-15%",
                color: "#2AA12E"
            },
            "-3": {
                text: "-7..-9%",
                color: "#53BF56"
            },
            "-2": {
                text: "-4..-6%",
                color: "#7BDD7E"
            },
            "-1": {
                text: "-1..-3%",
                color: "#A4FBA6"
            },
            "0": {
                text: "0%",
                color: "#ffcc99"
            },
            "1": {
                text: "1..3%",
                color: "#F29898"
            },
            "2": {
                text: "4..6%",
                color: "#E07575"
            },
            "3": {
                text: "7..9%",
                color: "#CF5352"
            },
            "4": {
                text: "10..15%",
                color: "#BE312F"
            },
            "5": {
                text: "> 16%",
                color: "#AD0F0C"
            }
        }
    },
    graphStyle: {
        opacity: 1.0,
        "fill-opacity": 1.0,
        "stroke-width": "2px" /* applicable only if fill-opacity is less than 1 */
    },
    expand: false
};


var osmProviders = {
    "openstreetmap.fr": {
        name: "openstreetmap.fr",
        url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
        shortName: "osm.fr"
    },
    "cyclosm.openstreetmap.fr": {
        name: "cyclosm.openstreetmap.fr",
        url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        shortName: "cyclosm.fr"
    },
    "openstreetmap.de": {
        name: "openstreetmap.de",
        url: "https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png",
        shortName: "osm.de"
    },
    "openstreetmap.org": {
        name: "openstreetmap.org",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        shortName: "osm.org"
    }
};

var providerDropdownButton;
var providerDropdownContent;

var printDropdownButton;
var printDropdownContent;
var printDropdownMapButton;
var printDropdownElevationButton;
var printSizeDropdownContent;
var printWidth;
var printHeight;

var printElement;


function getQueryParam(param, defaultValue) {
    var value = defaultValue;
    // no need for url decoding
    window.location.search.substr(1).split("&").forEach(function(item) {
        if (param === item.split("=")[0]) {
            value = item.split("=")[1];
        }
    });
    return value;
};


// check if we are in "print" mode (i.e. show only the map or the elevation chart, with no controls)
var printMode = getQueryParam("printMode");
var mapProvider = getQueryParam("mapProvider", "openstreetmap.fr");

var geojson = [];
var elevationFeatures = [];

var heightgraphMarkers = [];


// init map

var mapOptions = printMode === "map"
        ? {
            attributionControl: false,
            fadeAnimation: false,
            zoomAnimation: false,
            zoomControl: false
        }
        : {};
var map = new L.Map("map", mapOptions);
var osmProvider = osmProviders[mapProvider]; // use the default provider for start
var openstreetmap = L.tileLayer(
        osmProvider.url,
        {
            id: "openstreetmap",
            attribution: '<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
                + ' | <a href="privacypolicy.html" target="privacypolicy">Privacy policy</a>'
        }
);

{
    var northEastLat = Number(getQueryParam("bounds.northeast.lat", "61.957"));
    var northEastLng = Number(getQueryParam("bounds.northeast.lng", "-73.477"));
    var southWestLat = Number(getQueryParam("bounds.southwest.lat", "37.692"));
    var southWestLng = Number(getQueryParam("bounds.southwest.lng", "-129.771"));
    var bounds = new L.LatLngBounds(
        new L.LatLng(northEastLat, northEastLng),
        new L.LatLng(southWestLat, southWestLng)
    );
    map.addLayer(openstreetmap).fitBounds(bounds);
}

var displayGroup = new L.LayerGroup();
displayGroup.addTo(map);


var mapNode = document.getElementById("map");
var hgNode = document.querySelector(".heightgraph-container");
var hg;
if (printMode === "map") {
    var width = parseInt(getQueryParam("printWidth", "1600"));
    var height = parseInt(getQueryParam("printHeight", "1200"));

    mapNode.style.width = width + "px";
    mapNode.style.height = height + "px";
    map.invalidateSize();

    if (window.name) {
        geojson = JSON.parse(window.name);
        changeData();
    }
}
else if (printMode === "elevationchart") {
    var width = parseInt(getQueryParam("printWidth", "1600"));
    var height = parseInt(getQueryParam("printHeight", "500"));

    hg = L.control.heightgraph(heightgraphOptions);
    hg.addTo(map);

    hg.addData([]);
    hg.resize({width:width,height:height});
    hg._expand();

    // after expanding the chart, so I can get its size/width;
    // but before the DOM manipulations
    if (window.name) {
        geojson = JSON.parse(window.name);
        var chartWidth = getChartWidth();
        elevationFeatures = buildElevationFeatures(chartWidth);
        hg.addData(elevationFeatures);
    }

    // move the heightgraph chart outside of the map node
    var hgNode = document.querySelector(".heightgraph-container");
    document.body.appendChild(hgNode);

    // hide the map
    mapNode.style.display = "none";

    // restore the markers
    var heightgraphMarkersString = getQueryParam("heightgraphMarkers", "");
    if (heightgraphMarkersString) {
        JSON.parse(atob(heightgraphMarkersString))
            .forEach(marker => hg.addPermanentMarker(marker));
    }
}
else {
    L.control.scale({ metric: true, imperial: false }).addTo(map);
    document.querySelector(".controls").style.display = "flex";

    hg = L.control.heightgraph(heightgraphOptions);
    hg.addTo(map);
    // initialize with empty data
    hg.addData([]);

    hg.resize({width:1000, height:300});

    var onRoute = function(event) {
        hg.mapMousemoveHandler(event, {showMapMarker:true});
    }
    var outRoute = function(event) {
        hg.mapMouseoutHandler(1000);
    }
}


function changeData() {
    displayGroup.clearLayers();

    if (geojson.length !== 0) {
        var newLayer = L.geoJson(geojson, {
            style: function(feature) {
                var index = geojson.features.indexOf(feature);
                switch (index % 2) {
                    case 1:
                        return { color: "#888" };
                    default:
                        return { color: "#000" };
                }
            }
        });
        newLayer.on({
            "mousemove": onRoute,
            "mouseout": outRoute,
        });

        var newBounds = newLayer.getBounds();
        displayGroup.addLayer(newLayer);
        map.fitBounds(newBounds);
    }

    if (geojson.length === 0) {
        printDropdownMapButton.title = "Upload a track before printing";
        printDropdownMapButton.classList.add("disabled");
    }
    else {
        printDropdownMapButton.title = "";
        printDropdownMapButton.classList.remove("disabled");
    }

    changeHeightgraphData();
}
function buildLatLng(coords) {
    if (coords.length < 2 || coords.length > 3) {
        // invalid point
        return null;
    }
    else {
        return L.latLng(
            coords[1],
            coords[0],
            coords.length === 3 ? coords[2] : undefined);
    }
}
function getChartWidth() {
    var hgWidth;
    if (document.getElementsByClassName("heightgraph-container").length > 0) {
        var hgElement = document.getElementsByClassName("heightgraph-container")[0];
        if (hgElement.getElementsByTagName("g").length > 0) {
            hgGElement = hgElement.getElementsByTagName("g")[0];
            if (hgGElement.getElementsByClassName("grid").length > 1) {
                hgGRectElement = hgGElement.getElementsByClassName("grid")[1];
                hgWidth = hgGRectElement.getBoundingClientRect().width;
            }
        }
    }
    return hgWidth;
}
function buildElevationFeatures(chartWidth) {
    var latLngs = [];
    geojson.features.forEach(function(feature) {
        if (feature.geometry.type === "MultiLineString") {
            feature.geometry.coordinates.forEach(function(lineString) {
                lineString.forEach(function(coord) {
                    var latLng = buildLatLng(coord);
                    if (latLng !== undefined) {
                        latLngs.push(latLng);
                    }
                });
            });
        }
        else if (feature.geometry.type === "LineString") {
            feature.geometry.coordinates.forEach(function(coord) {
                var latLng = buildLatLng(coord);
                if (latLng !== undefined) {
                    latLngs.push(latLng);
                }
            });
        }
    });
    return geoDataExchange.buildGeojsonFeatures(
            latLngs,
            {
                interpolateElevation: true,
                normalize: true,
                chartWidthInPixels: chartWidth
            }
    );
}
function changeHeightgraphData() {
    if (geojson.length !== 0) {

        if (hg._showState !== true) {
            hg._expand();
        }

        // after expanding heightgraph, so I can get its width
        var chartWidth = getChartWidth();
        elevationFeatures = buildElevationFeatures(chartWidth);
    }
    else {
        elevationFeatures = [];

        hg._removeMarkedSegmentsOnMap();
        hg._resetDrag();
    }

    if (elevationFeatures.length === 0) {
        printDropdownElevationButton.title = "Upload a track before printing";
        printDropdownElevationButton.classList.add("disabled");
    }
    else {
        printDropdownElevationButton.title = "";
        printDropdownElevationButton.classList.remove("disabled");
    }

    hg.addData(elevationFeatures);
}

function handleFileContent(extension, content) {
    var f;

    switch (extension) {
        case ".gpx":
            f = toGeoJSON.gpx;
            break;
        case ".kml":
            f = toGeoJSON.kml;
            break;
        case ".tcx":
            f = toGeoJSON.tcx;
            break;
        default:
            console.log("ERROR: Unknown extension '" + extension + "'");
            return;
    }

    var parser = new DOMParser();

    try {
        var doc = parser.parseFromString(content, "application/xml");
        geojson = f(doc);
        changeData();
    }
    catch (e) {
        console.log("ERROR: Cannot handle file content as GeoJSON.", e);
    }
}

function providerDropdownToggle() {
    if (providerDropdownContent.style.display === "flex") {
        // hide the dropdown
        providerDropdownContent.style.display = "none";
    }
    else {
        // mark the selected item and unmark the rest
        providerDropdownContent.querySelectorAll("span").forEach(
            function(providerItem) {
                var providerName = providerItem.innerText;
                if (providerName === osmProvider.name) {
                    providerItem.classList.add("dropdown-item-selected");
                }
                else {
                    providerItem.classList.remove("dropdown-item-selected");
                }
            }
        );
        
        // show the dropdown
        providerDropdownContent.style.display = "flex";
    }
}
function setProvider(provider) {
    var newOsmProvider = osmProviders[provider];
    if (newOsmProvider === osmProvider) {
        return;
    }

    osmProvider = newOsmProvider;
    openstreetmap.setUrl(osmProvider.url);
    updateProviderButton();
}
function updateProviderButton() {
    providerDropdownButton.innerHTML = "Provider: " + osmProvider.shortName + " &gt;";
}

function print() {
    var mode = printElement.toLowerCase();

    var width = parseInt(printWidth.value);
    if (width < 100 || printHeight > 99999) {
        width = 0;
    }

    var height = parseInt(printHeight.value);
    if (height < 100 || height > 99999) {
        height = 0;
    }

    if (mode === "map") {
        if (width === 0) {
            width = 1600;
        }
        if (height === 0) {
            height = 1200;
        }

        window.open(
                "index.html"
                        + "?printMode=" + mode
                        + "&printWidth=" + width
                        + "&printHeight=" + height
                        + "&mapProvider=" + osmProvider.name
                        + "&bounds.northeast.lat=" + map.getBounds().getNorthEast().lat
                        + "&bounds.northeast.lng=" + map.getBounds().getNorthEast().lng
                        + "&bounds.southwest.lat=" + map.getBounds().getSouthWest().lat
                        + "&bounds.southwest.lng=" + map.getBounds().getSouthWest().lng,
                // pass the geojson via the windowName property;
                // fetching it from the new window via window.opener doesn't work in local
                // due to security restrictions;
                // passing it via sessionStorage has this weird side effect that
                // uploading a new track and reopening the window will not update the content
                // (i.e. the sessionStorage in the new window does not update)
                JSON.stringify(geojson));
    }
    else if (mode === "elevationchart") {
        if (width === 0) {
            width = 1600;
        }
        if (height === 0) {
            height = 500;
        }

        window.open(
                "index.html"
                        + "?printMode=" + mode
                        + "&printWidth=" + width
                        + "&printHeight=" + height
                        + "&heightgraphMarkers=" + btoa(JSON.stringify(heightgraphMarkers)),
                // see comments above on opening the map in a new window
                // for why passing the geojson via windowName;
                // not passing the elevation features, before I need to rebuild them
                // for the new chart size/width
                JSON.stringify(geojson));
    }
}

function initFileSelect() {
    var file = document.getElementById("file");
    document.getElementById("file-trigger").addEventListener(
        "click",
        function() {
            file.click();
        }
    );
    file.addEventListener("change", handleFileSelect);
}

function initProviderDropdown() {
    providerDropdownContent.querySelectorAll("span").forEach(
        function(providerItem) {
            providerItem.addEventListener(
                "click",
                function() {
                    setProvider(providerItem.innerText);
                    providerDropdownToggle();
                }
            );
        }
    );
    providerDropdownButton.addEventListener("click", providerDropdownToggle);
    updateProviderButton();
}

function initPrintDropdown() {
    [printDropdownMapButton, printDropdownElevationButton].forEach(
        function(printItem) {
            printItem.title = "Upload a track before printing";
            printItem.classList.add("disabled");

            printItem.addEventListener(
                "click",
                function() {
                    if (printItem === printDropdownMapButton && geojson.length === 0) {
                        return;
                    }
                    if (printItem === printDropdownElevationButton && elevationFeatures.length === 0) {
                        return;
                    }

                    // remove the trailing ' >' from the text,
                    // then removing the potential space between words ' '
                    printElement = printItem.innerText.slice(0, -2).split(" ").join("");

                    printDropdownContent.style.display = "none";
                    printSizeDropdownContent.style.display = "flex";

                    if (printWidth.value === "" || printHeight.value === "") {
                        if (printItem === printDropdownMapButton) {
                            printWidth.value = "1600", printHeight.value = "1200";
                        }
                        else if (printItem === printDropdownElevationButton) {
                            printWidth.value = "1600", printHeight.value = "500";
                        }
                    }
                }
            );
        }
    );
    printSizeDropdownContent.querySelectorAll("span.size").forEach(
        function(sizeItem) {
            sizeItem.addEventListener(
                "click",
                function() {
                    var size = sizeItem.innerText;
                    var width, height;
                    if (printElement === "Map") {
                        switch (size) {
                            case "Small":
                                width = 800, height = 600;
                                break;
                            case "Large":
                                width = 3200, height = 2400;
                                break;
                            case "Medium":
                            default:
                                width = 1600, height = 1200;
                                break;
                        }
                    }
                    else if (printElement === "Elevationchart") {
                        switch (size) {
                            case "Small":
                                width = 800, height = 250;
                                break;
                            case "Large":
                                width = 3200, height = 1000;
                                break;
                            case "Medium":
                            default:
                                width = 1600, height = 500;
                                break;
                        }
                    }
                    printWidth.value = width;
                    printHeight.value = height;
                }
            );
        }
    );
    printSizeDropdownContent.querySelectorAll("span.action").forEach(
        function(action) {
            action.addEventListener("click", function() {
                print();
                printSizeDropdownContent.style.display = "none";
            });
        }
    );
    printDropdownButton.addEventListener("click", function() {
        var isL1Visible = printDropdownContent.style.display == "flex";
        var isL2Visible = printSizeDropdownContent.style.display == "flex";

        if (isL1Visible) {
            printDropdownContent.style.display = "none";
        }
        else if (isL2Visible) {
            printSizeDropdownContent.style.display = "none";
        }
        else if (isL1Visible == false && isL2Visible == false) {
            printDropdownContent.style.display = "flex";
        }
    });
}


function init() {
    providerDropdownButton = document.getElementById("provider-dropdown-button");
    providerDropdownContent = document.getElementById("provider-dropdown-content");

    printDropdownButton = document.getElementById("print-dropdown-button");
    printDropdownContent = document.getElementById("print-dropdown-content");
    printDropdownMapButton = document.getElementById("print-dropdown-map-button");
    printDropdownElevationButton = document.getElementById("print-dropdown-elevation-button");
    printSizeDropdownContent = document.getElementById("print-size-dropdown-content");

    printWidth = document.getElementById("printWidth");
    printHeight = document.getElementById("printHeight");

    initFileSelect();
    initProviderDropdown();
    initPrintDropdown();
}

function handleFileSelect(event) {
    if (event.target.files.length === 1) {
        var file = event.target.files[0];
        var reader = new FileReader();

        reader.onload = handleFileLoad(file.name);
        reader.readAsText(file);
    }
    else {
        console.log(" WARN: No files uploaded");
    }
}

function handleFileLoad(filename) {
    return function(event) {
        if (filename === null) {
            console.log("ERROR: Unknown filename; aborting");
            return;
        }

        filename = filename.trim();
        if (filename.length < 5) {
            console.log("ERROR: Cannot figure out the extension in filename '" + filename + "'");
            return;
        }

        var extension = filename.substr(-4);
        var content = event.target.result;
        handleFileContent(extension, content);
    }
}

