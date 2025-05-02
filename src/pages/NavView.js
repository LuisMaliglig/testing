import React, { useEffect, useRef, useState } from "react"; // Removed useMemo as it's not used now
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json"; // Make sure this path is correct
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png"; // Make sure this path is correct
import { buildSnappedRouteData } from "../components/routeUtils"; // Make sure this path is correct


const NavView = () => {
  // --- State Variables (from refined logic) ---
  const [awsReady, setAwsReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [processedRoutes, setProcessedRoutes] = useState(null); // Structured snapped data
  const [displayRouteStrings, setDisplayRouteStrings] = useState([]); // Strings for NavView display
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const [awsRouteData, setAwsRouteData] = useState(null); // Raw AWS response
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const navigate = useNavigate();

  // --- useEffect Hooks (from refined logic) ---

  // Effect for AWS Credentials
  useEffect(() => {
    AWS.config.region = awsConfig.region;
    const credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: awsConfig.identityPoolId,
    });
    AWS.config.credentials = credentials;

    credentials.get((err) => {
      if (err) {
        console.error("Error retrieving AWS credentials:", err);
        setErrorMsg("Error loading AWS credentials.");
      } else {
        console.log("AWS credentials loaded");
        setAwsReady(true);
      }
    });
  }, []);

  // Effect for Map Setup
  useEffect(() => {
    if (!mapContainerRef.current || !awsReady) return; // Wait for container and AWS key

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 12,
    });
    mapRef.current = map;

    map.on("load", () => {
      if (!mapRef.current) return; // Check if map still exists (cleanup might have run)
      mapRef.current.addSource("transit-route", {
        type: "geojson",
        data: transitRoute,
      });

      const layers = [
        { id: "mrt-line", filter: "MRT", color: "#facc15", width: 4 },
        { id: "lrt-line", filter: "LRT", color: "#22c55e", width: 4 },
        { id: "jeep-lines", filter: "Jeep", color: "#FFA500", width: 3 },
        { id: "p2p-bus-lines", filter: "P2P-Bus", color: "#f97316", width: 3 },
        { id: "bus-lines", filter: "Bus", color: "#3b82f6", width: 3 },
      ];

      layers.forEach(({ id, filter, color, width }) => {
         // Check if the layer already exists (optional, prevents errors on hot reload)
         if (!mapRef.current?.getLayer(id)) {
            mapRef.current?.addLayer({
               id, type: "line", source: "transit-route",
               filter: ["==", ["get", "type"], filter],
               layout: { "line-join": "round", "line-cap": "round" },
               paint: { "line-color": color, "line-width": width },
            });
         }
      });

      const stopLayers = [
         { id: "mrt-stops", filter: "MRT-Stop", color: "#facc15" },
         { id: "lrt-stops", filter: "LRT-Stop", color: "#16a34a" },
         { id: "bus-stops", filter: "Bus-Stop", color: "#3b82f6" },
      ];

      stopLayers.forEach(({ id, filter, color }) => {
         if (!mapRef.current?.getLayer(id)) {
            mapRef.current?.addLayer({
               id, type: "circle", source: "transit-route",
               filter: ["==", ["get", "type"], filter],
               paint: {
                  "circle-radius": 5, "circle-color": color,
                  "circle-stroke-color": "#fff", "circle-stroke-width": 1,
               },
            });
         }
      });
    });

    // Add error handling for map initialization
    map.on('error', (e) => {
       console.error('MapLibre GL error:', e);
       setErrorMsg('Map loading error.');
    });


    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        console.log("Map removed on cleanup");
      }
    };
  }, [awsReady]); // Rerun if awsReady changes (needed for API key in style)

  // --- Event Handlers (from refined logic) ---

  // Function to Handle Route Calculation Request
  const handleRouteSuggestion = async () => {
    setErrorMsg("");
    if (!origin || !destination) {
      setErrorMsg("Please select a valid origin and destination.");
      return;
    }
    if (!awsReady || !AWS.config.credentials?.accessKeyId) {
      setErrorMsg("AWS services not ready. Please wait or refresh.");
      return;
    }

    setIsLoading(true);
    setAwsRouteData(null);
    setProcessedRoutes(null);
    setDisplayRouteStrings([]);
    setSelectedRouteIndex(null);

    try {
      const originCoords = origin.split(",").map(Number);
      const destinationCoords = destination.split(",").map(Number);
      if (originCoords.length !== 2 || destinationCoords.length !== 2 || originCoords.some(isNaN) || destinationCoords.some(isNaN)) {
        throw new Error("Invalid coordinate format.");
      }

      const routeCalculator = new AWS.Location(); // Ensure AWS SDK is configured
      const params = {
        CalculatorName: awsConfig.routeCalculatorName,
        DeparturePosition: [originCoords[1], originCoords[0]], // Lon, Lat
        DestinationPosition: [destinationCoords[1], destinationCoords[0]], // Lon, Lat
        IncludeLegGeometry: true,
      };

      console.log("Calculating route with params:", params);
      const data = await routeCalculator.calculateRoute(params).promise();
      console.log("AWS Route Data Received:", data);
      setAwsRouteData(data); // Trigger processing effect

    } catch (error) {
      console.error("Error calculating route:", error);
      setErrorMsg(`Error calculating route: ${error.message || 'Please try again.'}`);
      setAwsRouteData(null);
      setIsLoading(false);
    }
  };

  // --- Processing and Navigation Effects (from refined logic) ---

  // Effect to Process AWS Data and Calculate Snapped Routes
  useEffect(() => {
    // Check if awsRouteData is valid and has Legs
    if (awsRouteData && awsRouteData.Legs && awsRouteData.Legs.length > 0) {
      console.log("Processing AWS data and snapping routes...");
      try {
        const snapped = buildSnappedRouteData(awsRouteData, transitRoute.features);
        console.log("Snapped routes calculated:", snapped);

        // **Important:** Check the structure returned by buildSnappedRouteData
        if (!snapped || !Array.isArray(snapped) || snapped.length === 0) {
           console.error("buildSnappedRouteData returned invalid data:", snapped);
           throw new Error("Snapping process returned no valid routes or invalid format.");
        }
        // Add a check for the *first* item's structure as a sample validation
        if (!snapped[0]?.properties?.label || !Array.isArray(snapped[0]?.properties?.segments)) {
            console.error("First route object from buildSnappedRouteData has invalid structure:", snapped[0]);
            throw new Error("Snapped route object structure is invalid (missing properties.label or properties.segments).");
        }


        setProcessedRoutes(snapped); // Store structured data

        // Generate display strings
        const displayStrings = snapped.map((route, index) => {
          if (route.properties?.label) {
            return route.properties.label;
          } else {
            const leg = awsRouteData.Legs[index] || awsRouteData.Legs[0];
            return `Route ${index + 1}: ${leg.Distance.toFixed(2)} km, ${(leg.DurationSeconds / 60).toFixed(1)} mins`;
          }
        });
        setDisplayRouteStrings(displayStrings);
        setSelectedRouteIndex(0);
        setIsLoading(false);

      } catch (error) {
         console.error("Error processing/snapping route data:", error);
         setErrorMsg(`Error processing route: ${error.message || 'Failed to analyze route.'}`);
         setProcessedRoutes(null);
         setDisplayRouteStrings([]);
         setSelectedRouteIndex(null);
         setIsLoading(false);
      }
    } else if (awsRouteData) {
       console.warn("AWS route data received but contains no Legs or is invalid.");
       // Avoid setting error if loading just finished and data is null/cleared
       if (isLoading) {
           setErrorMsg("Route calculation returned no path.");
           setIsLoading(false);
       }
    }
  }, [awsRouteData]); // Re-run only when raw AWS data changes

  // Effect to Navigate WHEN processedRoutes is ready
  // Inside NavView.js

// useEffect for processing results from buildSnappedRouteData
// Assume 'processedRoutes' state holds the sorted array returned by buildSnappedRouteData
useEffect(() => {
  if (processedRoutes && processedRoutes.length > 0) {
      // Generate display strings (keep this part)
      const displayStrings = processedRoutes.map((route, index) => {
          return route?.properties?.label || `Route ${index + 1}: Invalid Data`;
      });
      setDisplayRouteStrings(displayStrings);

      // --- START: Modified Default Index Selection ---
      let defaultIndex = 0; // Default to the first item (fastest overall)

      // Find the index of the first route that is NOT 'Driving'
      const firstTransitIndex = processedRoutes.findIndex(
          route => route?.properties?.primary_mode !== 'Driving'
      );

      // If we found a transit route (index is not -1), use that index
      if (firstTransitIndex !== -1) {
          defaultIndex = firstTransitIndex;
          console.log(`NavView: Setting default selected index to first transit option: Index ${defaultIndex} ('${processedRoutes[defaultIndex]?.properties?.label}')`);
      } else {
           // If no transit routes were generated at all, stick with index 0 (Direct Route)
           console.log("NavView: No transit options generated, defaulting to index 0 (Direct Route).");
      }

      setSelectedRouteIndex(defaultIndex); // Set the calculated default index
      // --- END: Modified Default Index Selection ---

      setIsLoading(false); // Assuming loading stops here
  } else if (!isLoading) {
       // Handle case where processing finishes with no routes
       setDisplayRouteStrings([]);
       setSelectedRouteIndex(null);
  }
  // Make sure dependencies are correct, e.g.:
}, [processedRoutes, isLoading]); // Depends on when processedRoutes is ready

// The separate useEffect for navigation should remain the same,
// as it uses the selectedRouteIndex set above.
useEffect(() => {
  // Navigate only when processedRoutes exist AND selectedRouteIndex is set
  if (processedRoutes && processedRoutes.length > 0 && selectedRouteIndex !== null && awsRouteData) {
      console.log(`NavView: Triggering navigation with selected index: ${selectedRouteIndex}`);
      navigate("/route-breakdown", {
          state: {
              origin, destination,
              suggestedRoutes: processedRoutes, // Pass the full sorted list
              selectedRouteIndex: selectedRouteIndex, // Pass the potentially adjusted index
              awsRouteData,
              snappedRoutes: processedRoutes // Pass same list for snapped data
          },
      });
  }
   // Check dependencies: ensure navigation doesn't loop unnecessarily
}, [processedRoutes, selectedRouteIndex, awsRouteData, navigate, origin, destination]);

  // --- JSX Return Statement (Your Original Structure) ---
  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Map Container */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
      {/* Overlay */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          backdropFilter: "blur(4px)", backgroundColor: "rgba(0, 0, 0, 0.4)", zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {/* Content Box */}
        <div
          style={{
            position: "relative", textAlign: "center", color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.6)", padding: "32px", borderRadius: "5px",
            minWidth: "360px", maxWidth: "90%",
          }}
        >
          {/* Top Right Controls */}
          <div
            style={{
              position: "absolute", top: "16px", right: "16px",
              display: "flex", alignItems: "center", gap: "12px",
            }}
          >
            <img
              src={logo} alt="Logo"
              style={{ width: "40px", height: "40px", cursor: "pointer" }}
              onClick={() => navigate("/")} // Navigate to home/landing
            />
            <button
              onClick={() => navigate("/map-view")} // Navigate to map view
              style={{ // Your original button style
                padding: "8px 12px", backgroundColor: "#1e40af", color: "#fff",
                border: "none", borderRadius: "5px", cursor: "pointer",
              }}
            >
              Map View
            </button>
          </div>

          {/* Title */}
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "48px" }}>
            Route Navigator
          </h1>

          {/* Origin/Destination Selectors */}
          {/* Note: Added justifyContent: 'center' to the flex container */}
          <div style={{ display: "flex", gap: "5px", justifyContent: 'center' }}>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              disabled={isLoading} // Disable during loading
              style={{ // Your original select style
                marginBottom: "20px", padding: "10px", borderRadius: "5px",
                border: "none", width: "300px", maxWidth: "45%", // Use max-width for flex
              }}
            >
              <option value="">Select Origin</option>
              {/* New Options */}
              <option value="14.656,121.032">SM North EDSA Area</option>
              <option value="14.604,120.984">Recto LRT Area</option>
              <option value="14.536,120.997">Baclaran LRT Area</option>
              <option value="14.585,121.057">Ortigas Center Area</option>
              {/* Keep one original option */}
              <option value="14.476337,121.039364">Alabang Town Center Area</option>

            </select>

            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              disabled={isLoading} // Disable during loading
              style={{ // Your original select style
                marginBottom: "20px", padding: "10px", borderRadius: "5px",
                border: "none", width: "300px", maxWidth: "45%", // Use max-width for flex
              }}
            >
              <option value="">Select Destination</option>
              {/* New Options */}
              <option value="14.551,121.052">BGC High Street Area</option>
              <option value="14.621,121.054">Cubao Araneta Area</option>
              <option value="14.598,120.983">Quiapo Area</option>
              <option value="14.551,121.028">Ayala Center Area (Makati)</option>
               {/* Keep one original option */}
              <option value="14.536381,120.988745">CCP Complex Area</option>

            </select>
          </div>

          {/* Suggest Button and Results Area */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "20px", gap: "10px" }}>
            <button
              onClick={handleRouteSuggestion}
              disabled={isLoading || !awsReady} // Disable during loading or if AWS not ready
              style={{ // Your original button style
                width: "150px", height: "50px", backgroundColor: "#1e40af",
                color: "#fff", border: "none", borderRadius: "5px",
                cursor: "pointer", fontSize: "1rem",
                // Optional: Style for disabled state
                opacity: (isLoading || !awsReady) ? 0.6 : 1,
              }}
            >
              {isLoading ? "Calculating..." : "Suggest Routes"}
            </button>

            {/* Display Area for Errors or Results */}
            <div style={{ marginTop: "20px", fontSize: "1.1rem", minHeight: '4em' /* Reserve space */ }}>
              {/* Show Error First */}
              {errorMsg && (
                 <div style={{ color: "#fca5a5" /* Light red */ }}>{errorMsg}</div>
              )}

              {/* Show Loading state (only if not erroring) */}
              {!errorMsg && isLoading && (
                 <div>Loading route...</div>
              )}

              {/* Show Results (only if not loading and no error) */}
              {!errorMsg && !isLoading && displayRouteStrings.length > 0 && selectedRouteIndex !== null && (
                <>
                  <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                    {/* Display the selected route string */}
                    {displayRouteStrings[selectedRouteIndex]}
                  </div>
                  {/* Indicate that navigation/details are loading */}
                  <div style={{ fontSize: '0.9rem', marginTop: '5px', color: '#a3a3a3' }}>
                     Loading route details...
                  </div>
                </>
              )}

               {/* Initial state message */}
               {!errorMsg && !isLoading && displayRouteStrings.length === 0 && (
                  <div>Please select origin and destination.</div>
               )}
            </div>
          </div> {/* End Button and Results Area */}
        </div> {/* End Content Box */}
      </div> {/* End Overlay */}
    </div> // End Root Div
  );
};

export default NavView;