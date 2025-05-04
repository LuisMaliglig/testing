import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config"; // Ensure path is correct
import transitRoute from "../data/transit-lines.json"; // Ensure path is correct
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png"; // Ensure path is correct
import { buildSnappedRouteData } from "../components/routeUtils"; // Ensure path is correct

const modeColors = {
  MRT: "#facc15", // Yellow-400
  LRT1: "#22c55e", // Green-500
  LRT2: "#7A07D1",
  Jeep: "#FFA500", // Orange
  "P2P-Bus": "#f97316", // Orange-500
  Bus: "#3b82f6", // Blue-500
  Walk: "#9ca3af", // Gray-400
  Driving: "#6b7280", // Gray-500 
};

const NavView = () => {
  // --- State Variables ---
  const [awsReady, setAwsReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const originMarkerRef = useRef(null); // Ref for origin marker instance
  const destinationMarkerRef = useRef(null); // Ref for destination marker instance

  // State for coordinates (object or null)
  const [originCoords, setOriginCoords] = useState(null);
  const [destinationCoords, setDestinationCoords] = useState(null);
  // State to manage the selection process: 'origin', 'destination', 'done'
  const [selectionMode, setSelectionMode] = useState('origin');

  // State for route calculation results
  const [processedRoutes, setProcessedRoutes] = useState(null);
  const [displayRouteStrings, setDisplayRouteStrings] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const [awsRouteData, setAwsRouteData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [instructionText, setInstructionText] = useState("Click on the map to select Origin");

  const navigate = useNavigate();

  // --- Effects ---

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

  // Function to add or update map markers
  const updateMarker = (lngLat, type) => {
    if (!mapRef.current) return;

    const markerOptions = {
        color: type === 'origin' ? "#00FF00" : "#FF0000", // Green for origin, Red for destination
        draggable: false // Keep markers fixed after placing
    };

    if (type === 'origin') {
        // Remove previous origin marker if it exists
        originMarkerRef.current?.remove();
        // Create and add new marker
        originMarkerRef.current = new maplibregl.Marker(markerOptions)
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(mapRef.current);
    } else if (type === 'destination') {
        destinationMarkerRef.current?.remove();
        destinationMarkerRef.current = new maplibregl.Marker(markerOptions)
            .setLngLat([lngLat.lng, lngLat.lat])
            .addTo(mapRef.current);
    }
  };

  // Map click handler
  const handleMapClick = useCallback((e) => {
    const coords = e.lngLat; // { lng: number, lat: number }
    console.log(`Map clicked at: ${coords.lat}, ${coords.lng}`);

    if (isLoading) return; // Don't allow selection during loading

    if (selectionMode === 'origin') {
        setOriginCoords(coords);
        updateMarker(coords, 'origin');
        setSelectionMode('destination');
        setInstructionText('Click on the map to select Destination');
        setDestinationCoords(null); // Clear destination if re-selecting origin
        destinationMarkerRef.current?.remove();
        setErrorMsg(""); // Clear errors on new selection
    } else if (selectionMode === 'destination') {
        // Prevent setting destination same as origin (optional check)
        if (originCoords && coords.lng === originCoords.lng && coords.lat === originCoords.lat) {
             setErrorMsg("Origin and Destination cannot be the same point.");
             return;
        }
        setDestinationCoords(coords);
        updateMarker(coords, 'destination');
        setSelectionMode('done');
        setInstructionText('Origin & Destination selected. Click "Suggest Routes".');
        setErrorMsg("");
    } else if (selectionMode === 'done') {
        // If already done, clicking again restarts the process
        console.log("Restarting selection process...");
        setOriginCoords(coords); // Set new origin
        updateMarker(coords, 'origin');
        setDestinationCoords(null); // Clear destination
        destinationMarkerRef.current?.remove();
        setSelectionMode('destination'); // Move to selecting destination
        setInstructionText('Click on the map to select Destination');
        // Reset route results if needed
        setProcessedRoutes(null);
        setDisplayRouteStrings([]);
        setSelectedRouteIndex(null);
        setAwsRouteData(null);
        setErrorMsg("");
    }
  }, [isLoading, selectionMode, originCoords]); // Include dependencies

  const addAllLayers = (map) => {
    // Function to safely add layer
    const safeAddLayer = (layerConfig) => {
        if (!map.getLayer(layerConfig.id)) {
            try { map.addLayer(layerConfig); }
            catch (e) { console.error(`Failed to add layer '${layerConfig.id}':`, e); }
        }
    };
    // Define layer configurations
    const layers = [
        { id: "mrt-line", type: "line", filter: ["==", ["get", "type"], "MRT"], paint: { "line-color": modeColors.MRT, "line-width": 4 } },
        { id: "lrt1-line", type: "line", filter: ["==", ["get", "type"], "LRT1"], paint: { "line-color": modeColors.LRT1, "line-width": 4 } },
        { id: "lrt2-line", type: "line", filter: ["==", ["get", "type"], "LRT1"], paint: { "line-color": modeColors.LRT2, "line-width": 4 } },
        { id: "jeep-lines", type: "line", filter: ["==", ["get", "type"], "Jeep"], paint: { "line-color": modeColors.Jeep, "line-width": 3, 'line-opacity': 0.7 } },
        { id: "p2p-bus-lines", type: "line", filter: ["==", ["get", "type"], "P2P-Bus"], paint: { "line-color": modeColors['P2P-Bus'], "line-width": 3 } },
        { id: "bus-lines", type: "line", filter: ["==", ["get", "type"], "Bus"], paint: { "line-color": modeColors.Bus, "line-width": 3 } },
        { id: "mrt-stops", type: "circle", filter: ["==", ["get", "type"], "MRT-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.MRT, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "lrt1-stops", type: "circle", filter: ["==", ["get", "type"], "LRT1-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.LRT1, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "lrt2-stops", type: "circle", filter: ["==", ["get", "type"], "LRT2-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.LRT2, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
        { id: "bus-stops", type: "circle", filter: ["==", ["get", "type"], "Bus-Stop"], paint: { "circle-radius": 4, "circle-color": modeColors.Bus, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } },
    ];

    // Add each layer
    layers.forEach(layer => {
        safeAddLayer({
            ...layer,
            source: "transit-route", // Use the common source
            layout: { "line-join": "round", "line-cap": "round" }, // Common layout for lines
        });
    });
    console.log("Transit layers added to map.");
  };

  // Effect for Map Setup
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 11,
    });
    mapRef.current = map;

    map.on("load", () => {
        if (!mapRef.current || !isMounted) return;
        console.log("Map loaded.");

        // --- ADD SOURCE AND LAYERS ---
        if (!mapRef.current.getSource("transit-route")) {
            mapRef.current.addSource("transit-route", {
                type: "geojson",
                data: transitRoute // Use the imported GeoJSON data
            });
            console.log("Source 'transit-route' added.");
        }
        addAllLayers(map); // Add the layers defined above
        // -----------------------------

        map.on('click', handleMapClick); // Add click listener
    });

    map.on('error', (e) => console.error("MapLibre Error:", e));

    // Cleanup
    return () => {
      isMounted = false;
      if (mapRef.current) {
         if (mapRef.current.getStyle()) { mapRef.current.off('click', handleMapClick); }
         mapRef.current.remove(); mapRef.current = null;
         console.log("Map removed on cleanup");
      }
      originMarkerRef.current?.remove();
      destinationMarkerRef.current?.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awsReady, handleMapClick]); // Dependencies


  // --- Route Calculation Logic ---

  // Function to Handle Route Calculation Request
  const handleRouteSuggestion = async () => {
    setErrorMsg(""); // Clear previous errors
    // Check if both origin and destination coordinates are set
    if (!originCoords || !destinationCoords) {
      setErrorMsg("Please select both Origin and Destination on the map.");
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
      const routeCalculator = new AWS.Location();
      const params = {
        CalculatorName: awsConfig.routeCalculatorName,
        // Use coordinates directly, ensuring [longitude, latitude] order
        DeparturePosition: [originCoords.lng, originCoords.lat],
        DestinationPosition: [destinationCoords.lng, destinationCoords.lat],
        IncludeLegGeometry: true,
      };

      console.log("Calculating route with params:", params);
      const data = await routeCalculator.calculateRoute(params).promise();
      console.log("AWS Route Data Received:", data);
      setAwsRouteData(data); // Trigger processing effect

    } catch (error) {
      console.error("Error calculating AWS route:", error);
      setErrorMsg(`Error calculating route: ${error.message || 'Please try again.'}`);
      setAwsRouteData(null);
      setIsLoading(false);
    }
  };

  // Effect to Process AWS Data and Calculate Snapped Routes
  useEffect(() => {
    if (awsRouteData && awsRouteData.Legs && awsRouteData.Legs.length > 0) {
      console.log("Processing AWS data and snapping routes...");
      try {
        const snapped = buildSnappedRouteData(awsRouteData, transitRoute.features);
        console.log("Snapped routes calculated:", snapped);
        if (!snapped || snapped.length === 0) { throw new Error("Snapping process returned no valid routes."); }
        setProcessedRoutes(snapped); // Store structured data

        const displayStrings = snapped.map((route, index) => route?.properties?.label || `Route ${index + 1}`);
        setDisplayRouteStrings(displayStrings);

        // Set default selection (prioritize first non-driving)
        let defaultIndex = 0;
        const firstTransitIndex = snapped.findIndex(route => route?.properties?.primary_mode !== 'Driving');
        if (firstTransitIndex !== -1) { defaultIndex = firstTransitIndex; }
        setSelectedRouteIndex(defaultIndex);

      } catch (error) {
         console.error("Error processing/snapping route data:", error);
         setErrorMsg(`Error processing route: ${error.message || 'Failed to analyze route.'}`);
         setProcessedRoutes(null); setDisplayRouteStrings([]); setSelectedRouteIndex(null);
      } finally {
         setIsLoading(false); // Stop loading indicator
      }
    } else if (awsRouteData) {
       console.warn("AWS route data received but contains no Legs.");
       setErrorMsg("Route calculation returned no path.");
       setIsLoading(false);
    }
  }, [awsRouteData]); // Dependency: Only run when awsRouteData changes


  // Effect to Navigate WHEN processedRoutes is ready AND user hasn't re-clicked map
  useEffect(() => {
    // Navigate only when results are processed and selection is 'done'
    if (processedRoutes && processedRoutes.length > 0 && selectedRouteIndex !== null && awsRouteData && selectionMode === 'done') {
        console.log(`Navigating to /route-breakdown with selected index: ${selectedRouteIndex}`);

        // Format coordinates back to strings for RouteBreakdown compatibility
        const originString = originCoords ? `${originCoords.lat},${originCoords.lng}` : "";
        const destinationString = destinationCoords ? `${destinationCoords.lat},${destinationCoords.lng}` : "";

        navigate("/route-breakdown", {
            state: {
                origin: originString, // Pass formatted string
                destination: destinationString, // Pass formatted string
                suggestedRoutes: processedRoutes,
                selectedRouteIndex: selectedRouteIndex,
                awsRouteData,
                snappedRoutes: processedRoutes // Pass same list
            },
        });
    }
  }, [processedRoutes, selectedRouteIndex, awsRouteData, navigate, originCoords, destinationCoords, selectionMode]);


  // --- JSX Return Statement ---
  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      {/* Map Container - Takes full space */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
      {/* Overlay UI Panel */}
      <div
        style={{
          position: "absolute", top: "20px", left: "20px", // Position top-left
          width: "340px", // Panel width
          maxHeight: "calc(100vh - 40px)", // Limit height
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(5px)",
          color: "white",
          zIndex: 10,
          borderRadius: "8px",
          boxShadow: "0 4px 15px rgba(0, 0, 0, 0.3)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Panel Header */}
        <div style={{ padding: "16px", borderBottom: '1px solid rgba(255, 255, 255, 0.2)', flexShrink: 0 }}>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <img src={logo} alt="Logo" style={{ width: "35px", height: "35px" }}/>
                <button onClick={() => navigate("/")} style={{ /* Minimalist back button */
                    background: 'none', border: 'none', color: '#a0aec0', cursor: 'pointer', fontSize: '0.8rem'
                 }}>
                    Back Home
                </button>
           </div>
           <h1 style={{ fontSize: "1.3rem", fontWeight: "600", margin: 0 }}>
             Select Route
           </h1>
        </div>

        {/* Panel Content (Scrollable) */}
        <div style={{ padding: "16px", overflowY: 'auto', flexGrow: 1 }}>

            {/* Instructions & Status */}
            <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'rgba(255, 255, 255, 0.1)', borderRadius: '5px', fontSize: '0.9rem', textAlign: 'center' }}>
                {instructionText}
            </div>

            {/* Display Selected Coords (Optional) */}
            <div style={{ fontSize: '0.8rem', marginBottom: '15px', color: '#d1d5db' }}>
                <div>Origin: {originCoords ? `${originCoords.lat.toFixed(5)}, ${originCoords.lng.toFixed(5)}` : 'Not selected'}</div>
                <div>Destination: {destinationCoords ? `${destinationCoords.lat.toFixed(5)}, ${destinationCoords.lng.toFixed(5)}` : 'Not selected'}</div>
            </div>

            {/* Error Message Display */}
            {errorMsg && (
                <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'rgba(255, 0, 0, 0.3)', borderRadius: '5px', fontSize: '0.9rem', color: '#fca5a5', textAlign: 'center' }}>
                    {errorMsg}
                </div>
            )}

            {/* Suggest Button */}
            <button
              onClick={handleRouteSuggestion}
              disabled={isLoading || selectionMode !== 'done'} // Disable if loading or selection not complete
              style={{
                width: "100%", height: "45px",
                backgroundColor: (selectionMode === 'done' && !isLoading) ? "#1e40af" : '#4b5563', // Blue when active, gray otherwise
                color: "#fff", border: "none", borderRadius: "5px", cursor: (selectionMode === 'done' && !isLoading) ? "pointer" : 'not-allowed',
                fontSize: "1rem", fontWeight: '600',
                opacity: (selectionMode === 'done' && !isLoading) ? 1 : 0.6,
                transition: 'background-color 0.2s ease, opacity 0.2s ease'
              }}
            >
              {isLoading ? "Calculating..." : "Suggest Routes"}
            </button>

             {/* Display Route Summaries (if calculated) */}
             {/* This section is removed as navigation happens automatically now */}
             {/* {displayRouteStrings.length > 0 && !isLoading && ( ... )} */}

        </div> {/* End Panel Content */}
      </div> {/* End Overlay UI Panel */}
    </div> // End Root Div
  );
};

export default NavView;