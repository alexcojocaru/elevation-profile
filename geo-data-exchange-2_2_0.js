(function (global, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? factory(exports) :
    typeof define === "function" && define.amd ? define(["exports"], factory) :
    (factory((global.geoDataExchange = global.geoDataExchange || {})));
}(this, function (exports) { "use strict";

    var internal = {};
    exports.internal = internal;

    var defaultOptions = {
        // whether or not to compensate for the bug in Leaflet.Heightgraph
        // which makes the chart rendering to break if the track contains points
        // without an elevation/altitude coordinate;
        // if set to true, the elevation of these points will be interpolated
        // from the adjacent points which have it
        interpolateElevation: false,

        // whether or not to smooth out the elevation coordinates;
        // if the gradients change too often, the chart will be very busy;
        // normalizing the gradients result in less often changes, hence a less jagged chart
        normalize: false,

        // the width (in pixels) of the chart element; this is used to calculate the min length
        // of each feature (i.e. list of point with the same gradient), so that there isn't
        // an excessive/ number of features on the chart (which would make it look very busy);
        // this is applicable only if the normalization is enabled
        chartWidthInPixels: 1600,

        // the min width (in pixels) of each feature (i.e. list of points with the same gradient);
        // this is applicable only if the normalization is enabled
        minNormalizationDistanceInPixels: 5
    };
    exports.defaultOptions = defaultOptions;

    /**
     * Convert the list of LatLng points to a list of elevation features.
     * The attributeType property of each feature corresponds to its gradient level.
     *
     * Gradient levels are defined as follows:
     * level -5:      ... -16%
     * level -4: -15% ... -10%
     * level -3:  -9% ...  -7%
     * level -2:  -6% ...  -4%
     * level -1:  -3% ...  -1%
     * level  0:   0%
     * level  1:   1% ...   3%
     * level  2:   4% ...   6%
     * level  3:   7% ...   9%
     * level  4:  10% ...  15%
     * level  5:  16% ...
     *
     * E.g.
     * {
     *       type: "Feature",
     *       geometry: {
     *           type: "LineString",
     *           coordinates: [
     *              [lng1, lat1, alt1],
     *              [lng2, lat2, alt2],
     *              ...
     *              [lngn, latn, altn],
     *           ]
     *       },
     *       properties: {
     *           attributeType: gradientLevel
     *       }
     *   }
     *
     * @param {LatLng[]} latLngs - an array of LatLng objects, guaranteed not to be empty
     * @param options - a set of options for building the GeoJSON feature collection;
     *     it defaults to defaultOptions if not provided
     */
    function buildGeojsonFeatures(latLngs, options) {
        var _options = typeof(options) === 'undefined' ? defaultOptions : options;

        var interpolate = _options.interpolateElevation || defaultOptions.interpolateElevation;
        var normalize = _options.normalize || defaultOptions.normalize;

        var minNormalizationDistance = 0;
        if (normalize) {
            var chartWidthInPixels =
                    _options.chartWidthInPixels || defaultOptions.chartWidthInPixels;
            var minNormalizationDistanceInPixels =
                    _options.minNormalizationDistanceInPixels
                            || defaultOptions.minNormalizationDistanceInPixels;

            var trackLength = _calculateDistance(latLngs);
            minNormalizationDistance =
                    minNormalizationDistanceInPixels * trackLength / chartWidthInPixels;
        }

        var features = _buildFeatures(latLngs, interpolate, normalize, minNormalizationDistance);

        return [
            {
                type: "FeatureCollection",
                features: features,
                properties: {
                    Creator: "github.com/alexcojocaru/geo-data-exchange",
                    records: features.length,
                    summary: "gradient"
                }
            }
        ];
    };
    exports.buildGeojsonFeatures = buildGeojsonFeatures;

    /**
     * Convert the list of LatLng points to a list of elevation features.
     *
     * @param {LatLng[]} latLngs - an array of LatLng objects, guaranteed not to be null
     * @param Boolean interpolate - whether to interpolate the altitude on points without it
     * @param Boolean normalize - whether to normalize the gradients
     * @param Number minNormalizationDistance - the min distance over which the gradient is constant
     */
    function _buildFeatures(latLngs, interpolate, normalize, minNormalizationDistance) {
        var features = [];

        if (latLngs.length === 0) {
            return features;
        }

        var latLngAlts = _filterCoordinatesWithAltitude(latLngs);

        if (latLngAlts.length < 2) {
            features.push(_buildFeature(latLngs, _calculateGradient([]), interpolate));
            return features;
        }

        // make a feature with all points without altitude at the start of the list
        if (latLngAlts[0].index > 0) {
            var points = latLngs.slice(0, latLngAlts[0].index + 1); // include this point
            features.push(_buildFeature(points, _calculateGradient([]), interpolate));
        }

        var startIndex = 0; // the index of the start point of the current feature
        var previousStartIndex = 0; // the index of the start point of the previous feature
        var length = _calculateDistance(
            // need to consider all points (even those without alt)
            // between previous and current
            latLngs.slice(latLngAlts[0].index, latLngAlts[1].index + 1)
        ); // the length of the current feature
        var previousGradient = _calculateGradient(latLngAlts.slice(0, 2).map((lla) => lla.point));

        for (var i = 2; i < latLngAlts.length; i++) {
            var gradient = _calculateGradient(latLngAlts.slice(i-1, i+1).map((lla) => lla.point));

            if (previousGradient != gradient) {
                if (normalize === true && length < minNormalizationDistance) {
                    previousGradient = _calculateGradient(
                        latLngAlts.slice(startIndex, i+1).map((lla) => lla.point)
                    );
                }
                else {
                    var startOfFeature = latLngAlts[startIndex];
                    var endOfFeature = latLngAlts[i-1];
                    var points = latLngs.slice(startOfFeature.index, endOfFeature.index + 1);
                    features.push(_buildFeature(points, previousGradient, interpolate));

                    previousStartIndex = startIndex;
                    startIndex = i - 1;
                    length = 0;
                    previousGradient = gradient;
                }
            }

            length += _calculateDistance(
                // need to consider all points (even those without alt)
                // between previous and current
                latLngs.slice(latLngAlts[i-1].index, latLngAlts[i].index + 1)
            );
        }

        var lastLatLngAlt = latLngAlts.slice(-1)[0];

        var points = latLngs.slice(latLngAlts[startIndex].index, lastLatLngAlt.index + 1);
        if (normalize === true && _calculateDistance(points) < minNormalizationDistance) {
            // remove the last feature (if any)
            features.pop();

            // append these points to the previous feature
            // (the trailing points without altitude need a separate feature with 0 gradient)
            var jointPoints = latLngs.slice(
                latLngAlts[previousStartIndex].index,
                lastLatLngAlt.index + 1
            );
            var jointGradient = _calculateGradient(
                latLngAlts.slice(previousStartIndex).map((lla) => lla.point)
            );
            features.push(_buildFeature(jointPoints, jointGradient, interpolate));
        }
        else {
            // make a new feature until the last point with altitude
            // (the trailing points without altitude need a separate feature with 0 gradient)
            features.push(_buildFeature(points, previousGradient, interpolate));
        }

        // make a new feature with the trailing points which don't have an altitude
        if (lastLatLngAlt.index < latLngs.length - 1) {
            var trailingPoints = latLngs.slice(lastLatLngAlt.index, latLngs.length);
            features.push(_buildFeature(trailingPoints, _calculateGradient([]), interpolate));
        }

        return features;
    }
    internal._buildFeatures = _buildFeatures;

    /**
     * Return a new array with only the points with altitude,
     * mapped to their index in the initial array.
     * The points without altitude, and the points which fall within fuzzy range of each other,
     * are not included.
     */
    function _filterCoordinatesWithAltitude(latLngs) {
        var latLngAlts = [];

        for (var i = 0; i < latLngs.length; i++) {
            var point = latLngs[i];
            if (_hasAltitude(point) == false) {
                continue;
            }

            if (latLngAlts.length > 0) {
                var last = latLngAlts.slice(-1)[0];
                if (_isInFuzzyRange(last.point, point)) {
                    continue;
                }
            }

            latLngAlts.push({
                point: point,
                index: i
            });
        }

        return latLngAlts;
    }
    internal._filterCoordinatesWithAltitude = _filterCoordinatesWithAltitude;

    /**
     * Return true if the given point has an altitude coordinate, false otherwise.
     */
    function _hasAltitude(point) {
        return typeof point.alt !== "undefined";
    }
    internal._hasAltitude = _hasAltitude;

    /**
     * Return true if the second point is within fuzzy range of the first point.
     *
     * https://www2.jpl.nasa.gov/srtm/
     * https://wiki.openstreetmap.org/wiki/SRTM
     *
     * @param LatLng reference - the reference point
     * @param LatLng point - the point to test for fuzzy range
     */
    function _isInFuzzyRange(reference, point) {
        return _calculateDistance([reference, point]) < 30;
    }
    internal._isInFuzzyRange = _isInFuzzyRange;

    /**
     * Calculate the distance between all LatLng points in the given array.
     */
    function _calculateDistance(latLngs) {
        var distance = 0;
        for (var i = 1; i < latLngs.length; i++) {
            distance += latLngs[i].distanceTo(latLngs[i - 1]); // never negative
        }
        return distance;
    };
    internal._calculateDistance = _calculateDistance;

    /**
     * Calculate the gradient between the first and last point in the LatLng array,
     * and map it to a gradient level.
     * If less than 2 points have an altitude coordinate, the 0 gradient is returned.
     */
    function _calculateGradient(latLngs) {
        if (latLngs.length < 2) {
            return _mapGradient(0);
        }

        // find the index of the first point with a valid altitude
        var firstIndex = -1;
        for (var i = 0; i < latLngs.length; i++) {
            if (_hasAltitude(latLngs[i])) {
                firstIndex = i;
                break;
            }
        }
        // if no point with a valid altitude was found, there's not much to do here
        if (firstIndex == -1) {
            return _mapGradient(0);
        }

        // find the index of the last point with a valid altitude
        var lastIndex = -1;
        for (var i = latLngs.length - 1; i > firstIndex; i--) {
            if (_hasAltitude(latLngs[i])) {
                lastIndex = i;
                break;
            }
        }
        // if no point with a valid altitude was found between firstIndex and end of array,
        // there's not much else to do
        if (lastIndex == -1) {
            return _mapGradient(0);
        }

        var altDelta = latLngs[lastIndex].alt - latLngs[firstIndex].alt;

        // calculate the distance only from firstIndex to lastIndex;
        // points before or after don't have a valid altitude,
        // hence they are not included in the gradient calculation
        var distance = _calculateDistance(latLngs.slice(firstIndex, lastIndex + 1));

        var currentGradientPercentage = distance == 0 ? 0 : (altDelta * 100) / distance;
        var currentGradient = _mapGradient(currentGradientPercentage);
        return currentGradient;
    };
    internal._calculateGradient = _calculateGradient;

    function _buildFeature(latLngs, gradient, interpolate) {
        var latLngsWithElevation = _interpolateElevation(latLngs, interpolate);
        return {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: latLngsWithElevation.map((p) => [p.lng, p.lat, p.alt])
            },
            properties: {
                attributeType: gradient
            }
        };
    };

    /**
     * If the interpolate flag is true, return a new list of LatLng points
     * which all have the elevation coordinate set,
     * so that the overall gradient profile of the point list stays the same.
     * If there are points without elevation at the start or end of the given list,
     * the elevation coordinate is set so that the gradient profile to the closest point
     * with elevation is flat (i.e. the gradient is 0).
     * If the interpolate flag is false, the given list is returned.
     */
    function _interpolateElevation(latLngs, interpolate) {
        if (interpolate !== true || latLngs.length === 0) {
            return latLngs;
        }

        var result = latLngs.slice();

        _interpolateElevationStart(result);
        _interpolateElevationEnd(result);

        // find points without elevation and set it
        var previousIndex = -1; // keep track of the index of the previous point with elevation
        for (var i = 0; i < result.length; i++) {
            if (_hasAltitude(result[i])) {
                previousIndex = i;
                continue;
            }

            // we've just found the first point in a potential series

            // if there is no previous point with elevation (which is unexpected),
            // we're in a pickle, hence skip the current point
            if (previousIndex == -1) {
                continue;
            }

            // look up the next point with ele
            var nextIndex = i + 1;
            for (; nextIndex < result.length; nextIndex++) {
                if (_hasAltitude(result[nextIndex])) {
                    break;
                }
            }
            // if we got to the end of list and haven't found a point with elevation
            // (which is unexpected), we're in a pickle, hence skip the current point
            if (nextIndex == result.length) {
                continue;
            }

            // fix the elevation on all points in the current series
            _interpolateElevationSublist(result, previousIndex + 1, nextIndex - 1);

            // finally, since we've fixed the current series,
            // skip to the next point with elevation
            i = nextIndex - 1;
        }

        return result;
    };
    internal._interpolateElevation = _interpolateElevation;

    /*
     * Check for points without elevation at the start of the list;
     * if such points are found, set their elevation to be the same
     * as the elevation on the first point with such coordinate.
     * If no points in the list have an elevation coordinate, set it to 0 on all.
     * Note that the given list of LatLng points is mutated.
     */
    function _interpolateElevationStart(latLngs) {
        // if the list is empty, or the first point has elevation, there's nothing to do
        if (latLngs.length == 0 || _hasAltitude(latLngs[0])) {
            return;
        }

        var index = 0; // the index of the first point with elevation
        var alt = 0; // the elevation of the first point with such coordinate
        for (; index < latLngs.length; index++) {
            if (_hasAltitude(latLngs[index])) {
                alt = latLngs[index].alt;
                break;
            }
        }
        // set the elevation on all points without it at the start of the list
        for (var i = 0; i < index; i++) {
            var point = latLngs[i];
            latLngs[i] = L.latLng(point.lat, point.lng, alt);
        }
    };

    /*
     * Check for points without elevation at the end of the list;
     * if such points are found, set their elevation to be the same
     * as the elevation on the last point with such coordinate.
     * If no points in the list have an elevation coordinate, set it to 0 on all.
     * Note that the given list of LatLng points is mutated.
     */
    function _interpolateElevationEnd(latLngs) {
        // if the list is empty, or the last point has elevation, there's nothing to do
        if (latLngs.length == 0 || _hasAltitude(latLngs[latLngs.length - 1])) {
            return;
        }

        var index = latLngs.length - 1; // the index of the last point with elevation
        var alt = 0; // the elevation of the last point with such coordinate
        for (; index >= 0; index--) {
            if (_hasAltitude(latLngs[index])) {
                alt = latLngs[index].alt;
                break;
            }
        }
        // set the elevation on all points without it at the end of the list
        for (var i = index + 1; i < latLngs.length; i++) {
            var point = latLngs[i];
            latLngs[i] = L.latLng(point.lat, point.lng, alt);
        }
    };

    /**
     * Given the list of LatLng points,
     * and the series of points without elevation from startIndex to endIndex,
     * set the elevation on these points so that the gradient from
     * startIndex-1 to endIndex+1 is constant.
     * startIndex must be preceeded by a point with elevation;
     * endIndex must be followed by a point with elevation.
     * Note that the given list of LatLng points is mutated.
     */
    function _interpolateElevationSublist(latLngs, startIndex, endIndex) {
        var previousIndex = startIndex - 1; // index of the previous point with elevation before this series
        var nextIndex = endIndex + 1; // index of the next point with elevation after this series

        // calculate the overall gradient for the current series
        var distance = _calculateDistance(latLngs.slice(previousIndex, nextIndex + 1));
        var altitudeDelta = latLngs[nextIndex].alt - latLngs[previousIndex].alt;
        var gradient = distance == 0 ? 0 : (altitudeDelta * 100) / distance;

        // now  fix the elevation on each point in the series, one by one
        for (var i = startIndex; i <= endIndex; i++) {
            var dist = latLngs[i].distanceTo(latLngs[i - 1]);
            var alt = (gradient * dist) / 100 + latLngs[i - 1].alt;
            var point = latLngs[i];
            latLngs[i] = L.latLng(point.lat, point.lng, Number(alt.toFixed(1)));
        }
    };

    /**
     * Map a gradient percentage to one of the gradient levels.
     */
    function _mapGradient(gradientPercentage) {
        var gradient = Math.round(gradientPercentage);
        if (gradient < -16) {
            return -16;
        } else if (gradient > 16) {
            return 16;
        } else if (gradient >= -16 && gradient <= 16) {
            return gradient;
        } else {
            console.log("Unknown gradientPercentage: ", gradientPercentage);
            return 0;
        }
    };
    internal._mapGradient = _mapGradient;

}));
