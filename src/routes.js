const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();
const { decode } = require("@googlemaps/polyline-codec");

const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const router = express.Router();

const durationToSeconds = (duration) => {
    return Number(duration.replace('s', ''));
}


const getDistance = (point1, point2) => {

    const [lat1, lng1] = point1;
    const [lat2, lng2] = point2;

    const R = 6371000;

    const toRadians = (degree) => {
        return degree * Math.PI / 180;
    };

    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const getHalfwayPoint = (points, totalRouteDistance) => {
    const halfwayDistance = totalRouteDistance / 2;
    let travelDistance = 0;
    for (let i = 1; i < points.length; i++) {
        travelDistance += getDistance(points[i - 1], points[i]);

        if (travelDistance >= halfwayDistance) {
            return points[i];
        }
    }
    return points[points.length - 1];
}

router.get('/places/search', async (req, res) => {

    try {
        const { query } = req.query;
        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Query paramter is required'
            })
        }

        const response = await fetch(
            'https://places.googleapis.com/v1/places:searchText',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.priceLevel,places.location'
                },
                body: JSON.stringify({
                    textQuery: query
                })
            }
        )



        const data = await response.json();

        if (!response.ok) {
            return res.status(500).json({
                success: false,
                message: data
            })
        }

        const places = data.places || [];

        const formattedPlaces = places.map((place) => ({
            id: place.id,
            name: place.displayName?.text,
            address: place.formattedAddress,
            latitude: place.location?.latitude,
            longitude: place.location?.longitude
        }))


        return res.status(200).json({
            success: true,
            message: formattedPlaces
        })


    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
})

router.post('/places/nearby', async (req, res) => {
    try {

        const { latitude, longitude, radius, type } = req.body;

        if (!latitude || !longitude || !radius || !type) {
            return res.status(400).json({
                success: false,
                message: 'latitude, longitude,radius,and type are required'
            })
        }

        const response = await fetch(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.priceLevel,places.location,places.primaryType'
                },
                body: JSON.stringify({
                    includedTypes: [type],
                    maxResultCount: 10,
                    locationRestriction: {
                        circle: {
                            center: {
                                latitude,
                                longitude
                            },
                            radius
                        }
                    }
                }),
            }
        )

        const data = await response.json();
        if (!response.ok) {
            return res.status(500).json({
                success: false,
                message: data
            })
        }

        return res.status(200).json({
            success: true,
            data
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
})

router.get('/places/:placeId', async (req, res) => {

    try {
        const { placeId } = req.params;
        if (!placeId) {
            return res.status(400).json({
                success: false,
                message: 'placeId are required'
            })
        }

        const response = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,nationalPhoneNumber,regularOpeningHours,reviews'
                },
            }
        );

        const data = await response.json();
        if (!response.ok) {
            return res.status(500).json({
                success: false,
                message: data
            })
        }

        return res.status(200).json({
            success: true,
            data
        });


    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        })
    }
})


router.get('/places/:placeId/analyze', async (req, res) => {
    try {
        const { placeId } = req.params;

        if (!placeId) {
            return res.status(400).json({
                success: false,
                message: 'Place ID is required'
            });
        }

        const response = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,reviews'
                }
            }
        );

        const place = await response.json();

        if (!response.ok) {
            return res.status(response.status).json({
                success: false,
                message: place
            });
        }

        const review = (place.reviews || [])
            .map((review) => review.text?.text)
            .filter(Boolean);

        const reviews = review.join("\n\n");

        console.log(reviews);

        const prompt = `You are analyzing a place for someone who want to go and eat there.
        Place:${place.displayName?.text}
        Rating:${place.rating}
        Number of rating:${place.userRatingCount}
        Reviews:${reviews}

        Answer :
        1. What are the Postive points?
        2. What are the netive points?
        3. Give a final score out of 10
        
        keep the answer pratical and concise
        `;

        const result = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt
        });

        return res.status(200).json({
            success: true,
            place: place.displayName?.text,
            analysis: result.text
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
});


router.post('/routes', async (req, res) => {
    try {

        const { originLat, originLng, destinationLat, destinationLng } = req.body;
        const response = await fetch(
            `https://routes.googleapis.com/directions/v2:computeRoutes`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
                },
                body: JSON.stringify({
                    origin: {
                        location: {
                            latLng: {
                                latitude: originLat,
                                longitude: originLng
                            }
                        }
                    },
                    destination: {
                        location: {
                            latLng: {
                                latitude: destinationLat,
                                longitude: destinationLng
                            }
                        }
                    },
                    travelMode: "DRIVE",
                    routingPreference: "TRAFFIC_AWARE"
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            route: data.routes?.[0]
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

router.post('/places/search-along-route', async (req, res) => {
    try {

        const { query, encodedPolyline } = req.body;
        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.json({
            success: true,
            places: data.places || [],
            routingSummaries: data.routingSummaries || []
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

router.post('/places/search-along-route-detour', async (req, res) => {
    try {

        const { query, encodedPolyline, maxDetourMinutes } = req.body;
        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    routingParameters: {
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        const originalRouteDuration = 1509;
        const originalRouteDistance = 4594;

        const placesWithDetour = (data.places || []).map((place, index) => {
            const routingSummary = data.routingSummaries?.[index];

            const firstLeg = routingSummary?.legs?.[0];
            const secondLeg = routingSummary?.legs?.[1];

            const distanceFromOrigin = firstLeg?.distanceMeters || 0;
            const journeyPercentage = (distanceFromOrigin / originalRouteDistance) * 100;

            const firstLegSeconds = firstLeg ? durationToSeconds(firstLeg.duration) : 0;
            const secondLegSeconds = secondLeg ? durationToSeconds(secondLeg.duration) : 0;

            const totalWithStop = firstLegSeconds + secondLegSeconds;
            const detourSeconds = totalWithStop - originalRouteDuration;


            return {
                id: place.id,
                name: place.displayName?.text,
                address: place.formattedAddress,
                detourMinutes: Math.round(detourSeconds / 60),
                journeyPercentage: Math.round(journeyPercentage)
            }
        })

        const filterPlaces = placesWithDetour.filter((place) => {
            return place.detourMinutes <= maxDetourMinutes;
        })

        filterPlaces.sort((a, b) => {
            return a.detourMinutes - b.detourMinutes;
        })

        const halfwayplaces = filterPlaces.filter((place) => {
            return (
                place.journeyPercentage >= 40 && place.journeyPercentage <= 60
            )
        })


        return res.json({
            success: true,
            places: halfwayplaces
            //routingSummaries:data.routingSummaries || []
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

router.post('/places/halfway-search', async (req, res) => {
    try {

        const { query, encodedPolyline } = req.body;

        //Decode

        const decodedPoints = decode(encodedPolyline);
        const middleIndex = Math.floor(decodedPoints.length / 2);

        const halfwayPoint = decodedPoints[middleIndex];

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];




        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    routingParameters: {
                        origin: {
                            longitude: halfwayLatitude,
                            longitude: halfwayLongitude
                        },
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }



        return res.json({
            success: true,
            halfwayPoint: {
                longitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || [],
            routingSummary: data.routingSummaries || []
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

router.post('/places/halfway-nearby', async (req, res) => {
    try {

        const { query, encodedPolyline } = req.body;

        //Decode

        const decodedPoints = decode(encodedPolyline);
        const middleIndex = Math.floor(decodedPoints.length / 2);

        const halfwayPoint = decodedPoints[middleIndex];

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];




        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    routingParameters: {
                        origin: {
                            longitude: halfwayLatitude,
                            longitude: halfwayLongitude
                        },
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    },
                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude: halfwayLatitude - 0.25,
                                longitude: halfwayLongitude - 0.25
                            },
                            high: {
                                latitude: halfwayLatitude + 0.25,
                                longitude: halfwayLongitude + 0.25
                            }
                        }
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }



        return res.json({
            success: true,
            halfwayPoint: {
                longitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || [],
            routingSummary: data.routingSummaries || []
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

router.post('/places/halfway-by-distance', async (req, res) => {
    try {

        const { query, encodedPolyline, distanceMeters } = req.body;

        //Decode

        const decodedPoints = decode(encodedPolyline);
        // const middleIndex = Math.floor(decodedPoints.length / 2);

        const halfwayPoint = getHalfwayPoint(decodedPoints, distanceMeters)

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];




        const response = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 10,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },

                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude: halfwayLatitude - 0.25,
                                longitude: halfwayLongitude - 0.25
                            },
                            high: {
                                latitude: halfwayLatitude + 0.25,
                                longitude: halfwayLongitude + 0.25
                            }
                        }
                    }
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }



        return res.json({
            success: true,
            halfwayPoint: {
                longitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            places: data.places || [],
            routingSummary: data.routingSummaries || []
        });

    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})

// Road trip Copilot orchestation route.


router.post('/road-trip/search', async (req, res) => {
    try {

        const { originLat, originLng, destinationLat, destinationLng, query, maxDetourMinutes } = req.body || {};

        //Step 1:GET The Main Route
        const routeResponse = await fetch(
            `https://routes.googleapis.com/directions/v2:computeRoutes`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'
                },
                body: JSON.stringify({

                    origin: {
                        location: {
                            latLng: {
                                latitude: originLat,
                                longitude: originLng
                            }
                        }
                    },

                    destination: {
                        location: {
                            latLng: {
                                latitude: destinationLat,
                                longitude: destinationLng
                            }
                        }
                    },
                    travelMode: 'DRIVE',
                    routingPreference: 'TRAFFIC_AWARE'

                })
            }
        );

        const routeData = await routeResponse.json();

        if (!routeResponse.ok) {
            return res.status(routeResponse.status).json(routeData);
        }

        const route = routeData.routes?.[0];

        if (!route) {
            return res.status(404).json({
                success: false,
                message: "No route found"
            })
        }

        const distanceMeters = route.distanceMeters;
        const originalRouteDuration = Number(route.duration.replace('s', ''));
        const encodedPolyline = route.polyline.encodedPolyline;

        // Find halfway point


        const decodedPoints = decode(encodedPolyline);
        const halfwayDistance = distanceMeters / 2;

        const halfwayPoint = getHalfwayPoint(decodedPoints, halfwayDistance);

        const halfwayLatitude = halfwayPoint[0];
        const halfwayLongitude = halfwayPoint[1];

        // step 3:search places around halway

        const placesResponse = await fetch(
            `https://places.googleapis.com/v1/places:searchText`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,routingSummaries'
                },
                body: JSON.stringify({
                    textQuery: query,
                    pageSize: 20,
                    searchAlongRouteParameters: {
                        polyline: {
                            encodedPolyline
                        }
                    },
                    locationRestriction: {
                        rectangle: {
                            low: {
                                latitude: halfwayLatitude - 0.25,
                                longitude: halfwayLongitude - 0.25
                            },
                            high: {
                                latitude: halfwayLatitude + 0.25,
                                longitude: halfwayLongitude + 0.25
                            }
                        }
                    },
                    routingParameters: {
                        origin: {
                            latitude: originLat,
                            longitude: originLng
                        },
                        travelMode: 'DRIVE',
                        routingPreference: 'TRAFFIC_AWARE'
                    }
                })
            }
        );

        const placesData = await placesResponse.json();
        if (!placesResponse.ok) {
            return res.status(placesResponse.status).json(placesData);
        }

        //step 4:calcute detour for evry place

        const placesWithDetour = (placesData.places || []).map((place, index) => {

            const routingSummary = placesData.routingSummaries?.[index];
            const firstLeg = routingSummary?.legs?.[0];
            const secondLeg = routingSummary?.legs?.[1];
            if (!firstLeg || !secondLeg) {
                return null;
            }

            const firstLegSeconds = durationToSeconds(firstLeg.duration);
            const secondLegSeconds = durationToSeconds(secondLeg.duration);

            const totalWithStop = firstLegSeconds + secondLegSeconds;
            const detourSeconds = totalWithStop - originalRouteDuration;

            const rating = place.rating || 0;
            const reviewCount = place.userRatingCount || 0;
            const detourMinutes = Math.round(detourSeconds / 60);

            const score = (rating * 20) + Math.min(reviewCount / 100, 20) - detourMinutes;

            return {
                id: place.id,
                name: place.displayName?.text,
                address: place.formattedAddress,
                rating: rating,
                userRatingCount: reviewCount,
                detourMinutes,
                score: Math.round(score)
            };
        }
        ).filter(Boolean);

        //step:5 filter by user's max detour

        const filteredPlaces = placesWithDetour.filter((place) => {
            return place.detourMinutes <= maxDetourMinutes;
        })

        // step 6: sort lowest detour first 

        filteredPlaces.sort((a, b) => {
            return b.score - a.score;
        })

        // step 7: final response 

        return res.json({
            success: true,
            halfwayPoint: {
                latitude: halfwayLatitude,
                longitude: halfwayLongitude
            },
            route: {
                distanceMeters,
                durationToSeconds: originalRouteDuration
            },
            places: filteredPlaces
        });


    } catch (err) {
        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
})





module.exports = router;