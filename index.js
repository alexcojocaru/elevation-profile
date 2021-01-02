var options = {
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
        url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
        shortName: "osm.fr"
    },
    "cyclosm.openstreetmap.fr": {
        url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
        shortName: "cyclosm.fr"
    },
    "openstreetmap.de": {
        url: "https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png",
        shortName: "osm.de"
    },
    "openstreetmap.org": {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        shortName: "osm.org"
    }
};


// init map

var map = new L.Map("map");
var osmProvider = osmProviders["openstreetmap.fr"];
var attr = "<a href=\"https://openstreetmap.org\">OpenStreetMap</a>"
        + " | <a href=\"privacypolicy.html\" target=\"privacypolicy\">Privacy policy</a>";

var openstreetmap = L.tileLayer(
    osmProvider.url,
    {
        id: "openstreetmap",
        attribution: attr
    }
);

var bounds = new L.LatLngBounds(
    new L.LatLng(61.957, -129.771),
    new L.LatLng(37.692, -73.477)
);
map.addLayer(openstreetmap).fitBounds(bounds)

var displayGroup = new L.LayerGroup();
displayGroup.addTo(map);

L.control.scale({ metric: true, imperial: false }).addTo(map);


// init heightgraph

var hg = L.control.heightgraph(options);
hg.addTo(map)
// initialize with empty data
hg.addData([]);

hg.resize({width:1000,height:300})

var onRoute = function(event) {
    hg.mapMousemoveHandler(event, {showMapMarker:true})
}
var outRoute = function(event) {
    hg.mapMouseoutHandler(1000)
}


function changeData(geojson) {
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

    changeHeightgraphData(geojson);
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
function changeHeightgraphData(geojson) {
    var elevationFeatures;

    if (geojson.length !== 0) {
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
        elevationFeatures = geoDataExchange.buildGeojsonFeatures(latLngs);

        if (hg._showState !== true) {
            hg._expand();
        }
    }
    else {
        elevationFeatures = [];

        hg._removeMarkedSegmentsOnMap();
        hg._resetDrag();
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
        var geojson = f(doc);
        changeData(geojson);
    }
    catch (e) {
        console.log("ERROR: Cannot handle file content as GeoJSON.", e);
    }
}

function dropdownToggle() {
    var dropdownContent = document.getElementById("dropdown-content");

    if (dropdownContent.style.display === "flex") {
        // hide the dropdown
        dropdownContent.style.display = "none";
    }
    else {
        // mark the selected item and unmark the rest
        document.querySelectorAll("div.dropdown-content > span").forEach(function(providerItem) {
            var providerName = providerItem.innerText;
            if (osmProviders[providerName] === osmProvider) {
                providerItem.classList.add("dropdown-item-selected");
            }
            else {
                providerItem.classList.remove("dropdown-item-selected");
            }
        })
        
        // show the dropdown
        dropdownContent.style.display = "flex";
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
    document.getElementById("dropdown-button").innerHTML = "Provider: " + osmProvider.shortName;
}
function init() {
    var file = document.getElementById("file");
    document.getElementById("file-trigger").addEventListener(
        "click",
        function() {
            file.click();
        }
    );
    file.addEventListener("change", handleFileSelect);

    document.querySelectorAll("div.dropdown-content > span").forEach(function(providerItem) {
        providerItem.addEventListener(
            "click",
            function() {
                setProvider(providerItem.innerText);
                dropdownToggle();
            }
        );
    });

    document.getElementById("dropdown-button").addEventListener("click", dropdownToggle);
    updateProviderButton();
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

