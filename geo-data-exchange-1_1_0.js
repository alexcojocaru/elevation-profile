(function (global, factory) {
    typeof exports === "object" && typeof module !== "undefined" ? factory(exports) :
    typeof define === "function" && define.amd ? define(["exports"], factory) :
    (factory((global.geoDataExchange = global.geoDataExchange || {})));
}(this, function (exports) { "use strict";

    var internal = {};
    exports.internal = internal;

    var defaultOptions = {
        // the track will be broken up into this many segments,
        // for the purpose of normalizing the elevation across each segment;
        // a high segment count, with each segment long enough, is the best choice;
        // too short segments results in poor normalization, due to inacurate altitudes for
        // points close to each other;
        // too few segments results in poor gradient,
        // due to ignoring the altitude on points in the middle;
        // min value is 10
        segments: 200,

        // the minimum distance (in meters) between points which we consider
        // for the purpose of calculating altitudes and gradients;
        // this comes into play for short routes, in order to make sure
        // we still have enough of a distance for each segment to normalize over;
        // for long routes, the segment distance will be longer than this,
        // thus increasing the accuracy;
        // too short of a segment would result in poor normalization,
        // for there won't be enough points on each segment to get a good altitude aproximation;
        // min value is 50
        minSegmentDistance: 200,

        // whether or not to compensate for the bug in Leaflet.Heightgraph
        // which makes the chart rendering to break if the track contains points
        // without an elevation/altitude coordinate;
        // if set to true, the elevation of these points will be interpolated
        // from the adjacent points which have it
        interpolateElevation: false
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
     * @param {LatLng[]} latLngs - an array of LatLng objects, guaranteed to be not empty
     * @param options - a set of options for building the GeoJSON feature collection;
     *     it defaults to defaultOptions if not provided
     */
    function buildGeojsonFeatures(latLngs, options) {
        var _options = typeof(options) === 'undefined' ? defaultOptions : options;

        var segmentsCount = _options.segmentsCount || defaultOptions.segments;
        if (segmentsCount < 10) {
            segmentsCount = 10;
        }

        var minSegmentDistance = _options.minSegmentDistance || defaultOptions.minSegmentDistance;
        if (minSegmentDistance < 50) {
            minSegmentDistance = 50;
        }

        var interpolate = typeof(_options.interpolateElevation) === 'undefined'
                ? defaultOptions.interpolateElevation
                : _options.interpolateElevation;

        // since the altitude coordinate on geo points is not very reliable, let's normalize it
        // by taking into account only the altitude on points at a given min distance
        var totalDistance = _calculateDistance(latLngs);
        var bufferMinDistance = Math.max(totalDistance / segmentsCount, minSegmentDistance);

        var segments = _partitionByMinDistance(latLngs, bufferMinDistance);

        var features = [];

        // this is going to be initialized in the first loop, no need to initialize now
        var currentFeature;

        // undefined is fine, as it will be different to the current gradient in the first loop
        var previousGradient;

        segments.forEach(function(segment) {
            var currentGradient = _calculateGradient(segment);

            if (currentGradient == previousGradient) {
                // the gradient hasn't changed, we can append this segment to the last feature;
                // since the segment contains, at index 0,
                // the last point on the current feature, add only points from index 1 onward
                _addPointsToFeature(currentFeature, segment.slice(1), interpolate);
            } else {
                // the gradient has changed; create a new feature
                currentFeature = _buildFeature(segment, currentGradient, interpolate);
                features.push(currentFeature);
            }

            // reset to prepare for the next iteration
            previousGradient = currentGradient;
        });

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
     * Given the list of latLng points, partition them into segments
     * at least _minDistance__ meters long,
     * where the first and last points on each segment always have a valid altitude.
     * NOTE: Given that some of the given points might not have a valid altitude,
     *       the first point(s) in the first buffer, as well as the last point(s)
     *       in the last buffer, might not have a valid altitude.
     */
    function _partitionByMinDistance(latLngs, minDistance) {
        var segments = [];

        // temporary buffer where we add points
        // until the distance between them is at least minDistance
        var buffer = [];

        // push all points up to (and including) the first one with a valid altitude
        var index = 0;
        for (; index < latLngs.length; index++) {
            var latLng = latLngs[index];
            buffer.push(latLng);
            if (typeof latLng.alt !== "undefined") {
                break;
            }
        }

        // since the segments are used for gradient calculation (hence alt is needed),
        // consider 0 length so far;
        // that's because all points so far, except for the last one, don't have an altitude
        var bufferDistance = 0;

        // since index was already used, start at the next one
        for (index = index + 1; index < latLngs.length; index++) {
            var latLng = latLngs[index];
            buffer.push(latLng); // the buffer contains at least 2 points by now
            bufferDistance =
                bufferDistance +
                // never negative
                buffer[buffer.length - 1].distanceTo(buffer[buffer.length - 2]);

            // if we reached the tipping point, add the buffer to segments, then flush it;
            // if this point doesn't have a valid alt, continue to the next one
            if (bufferDistance >= minDistance && typeof latLng.alt !== "undefined") {
                segments.push(buffer);
                // re-init the buffer with the last point from the previous buffer
                buffer = [buffer[buffer.length - 1]];
                bufferDistance = 0;
            }
        }

        // if the buffer is not empty, add all points from it (except for the first one)
        // to the last segment
        if (buffer.length > 0) {
            if (segments.length === 0) {
                segments.push(buffer);
            } else {
                var lastSegment = segments[segments.length - 1];
                for (var i = 1; i < buffer.length; i++) {
                    lastSegment.push(buffer[i]);
                }
            }
        }

        return segments;
    };
    internal._partitionByMinDistance = _partitionByMinDistance;

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
            if (typeof latLngs[i].alt !== "undefined") {
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
            if (typeof latLngs[i].alt !== "undefined") {
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

    /**
     * Add the given array of LatLng points to the end of the provided feature.
     */
    function _addPointsToFeature(feature, latLngs, interpolate) {
        var latLngsWithElevation = _interpolateElevation(latLngs, interpolate);
        latLngsWithElevation.forEach(function(point) {
            var coordinate = [point.lng, point.lat, point.alt];
            feature.geometry.coordinates.push(coordinate);
        });
    };

    function _buildFeature(latLngs, gradient, interpolate) {
        var latLngsWithElevation = _interpolateElevation(latLngs, interpolate);
        var coordinates = [];
        latLngsWithElevation.forEach(function(latLng) {
            coordinates.push([latLng.lng, latLng.lat, latLng.alt]);
        });

        return {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: coordinates
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
            if (typeof result[i].alt !== "undefined") {
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
                if (typeof result[nextIndex].alt !== "undefined") {
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

            // finally, since we've fixed the current series, skip to the next point
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
        if (latLngs.length == 0 || typeof latLngs[0].alt !== "undefined") {
            return;
        }

        var index = 0; // the index of the first point with elevation
        var alt = 0; // the elevation of the first point with such coordinate
        for (; index < latLngs.length; index++) {
            if (typeof latLngs[index].alt !== "undefined") {
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
        if (latLngs.length == 0 || typeof latLngs[latLngs.length - 1].alt !== "undefined") {
            return;
        }

        var index = latLngs.length - 1; // the index of the last point with elevation
        var alt = 0; // the elevation of the last point with such coordinate
        for (; index >= 0; index--) {
            if (typeof latLngs[index].alt !== "undefined") {
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
        if (gradientPercentage <= -16) {
            return -5;
        } else if (gradientPercentage > -16 && gradientPercentage <= -10) {
            return -4;
        } else if (gradientPercentage > -10 && gradientPercentage <= -7) {
            return -3;
        } else if (gradientPercentage > -7 && gradientPercentage <= -4) {
            return -2;
        } else if (gradientPercentage > -4 && gradientPercentage <= -1) {
            return -1;
        } else if (gradientPercentage > -1 && gradientPercentage < 1) {
            return 0;
        } else if (gradientPercentage >= 1 && gradientPercentage < 4) {
            return 1;
        } else if (gradientPercentage >= 4 && gradientPercentage < 7) {
            return 2;
        } else if (gradientPercentage >= 7 && gradientPercentage < 10) {
            return 3;
        } else if (gradientPercentage >= 10 && gradientPercentage < 16) {
            return 4;
        } else if (gradientPercentage >= 16) {
            return 5;
        } else {
            console.log("Unknown gradientPercentage: ", gradientPercentage, "; cannot map");
            return 0;
        }
    };
    internal._mapGradient = _mapGradient;

}));
