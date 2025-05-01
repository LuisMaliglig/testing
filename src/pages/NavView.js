import React, { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json";
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png";
import * as turf from "@turf/turf";
import { buildSnappedRouteData } from "../components/routeUtils";


const NavView = () => {
  const [awsReady, setAwsReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [suggestedRoutes, setSuggestedRoutes] = useState([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(null);
  const navigate = useNavigate();
  const [awsRouteData, setAwsRouteData] = useState(null);
  
  const snappedRouteData = useMemo(() => {
    if (!awsRouteData) return null;
    return buildSnappedRouteData(awsRouteData, transitRoute.features);
  }, [awsRouteData]);

  useEffect(() => {
    AWS.config.region = awsConfig.region;
    const credentials = new AWS.CognitoIdentityCredentials({
      IdentityPoolId: awsConfig.identityPoolId,
    });
    AWS.config.credentials = credentials;

    credentials.get((err) => {
      if (err) {
        console.error("Error retrieving AWS credentials:", err);
      } else {
        console.log("AWS credentials loaded");
        setAwsReady(true);
      }
    });
  }, []);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 12,
    });

    mapRef.current = map;

    map.on("load", () => {
      map.addSource("transit-route", {
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
        map.addLayer({
          id,
          type: "line",
          source: "transit-route",
          filter: ["==", ["get", "type"], filter],
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": color, "line-width": width },
        });
      });

      const stopLayers = [
        { id: "mrt-stops", filter: "MRT-Stop", color: "#facc15" },
        { id: "lrt-stops", filter: "LRT-Stop", color: "#16a34a" },
        { id: "bus-stops", filter: "Bus-Stop", color: "#3b82f6" },
      ];

      stopLayers.forEach(({ id, filter, color }) => {
        map.addLayer({
          id,
          type: "circle",
          source: "transit-route",
          filter: ["==", ["get", "type"], filter],
          paint: {
            "circle-radius": 5,
            "circle-color": color,
            "circle-stroke-color": "#fff",
            "circle-stroke-width": 1,
          },
        });
      });
    });

    return () => map.remove();
  }, []);

  const handleRouteSuggestion = async () => {
    if (!origin || !destination) {
      setSuggestedRoutes(["Please select valid origin and destination."]);
      return;
    }

    if (!AWS.config.credentials || !AWS.config.credentials.accessKeyId) {
      setSuggestedRoutes(["AWS credentials not yet available. Please try again."]);
      return;
    }

    const originCoords = origin.split(",").map(Number);
    const destinationCoords = destination.split(",").map(Number);

    const routeCalculator = new AWS.Location();

    const params = {
      CalculatorName: awsConfig.routeCalculatorName,
      DeparturePosition: [originCoords[1], originCoords[0]],
      DestinationPosition: [destinationCoords[1], destinationCoords[0]],
    };

    try {
      const data = await routeCalculator.calculateRoute(params).promise();
      setAwsRouteData(data); // ✅ Triggers useEffect

      const routes = data.Legs.map((leg, index) => {
        return `Route ${index + 1}: ${leg.Distance.toFixed(2)} km, ${(leg.DurationSeconds / 60).toFixed(1)} mins`;
      });
      setSuggestedRoutes(routes);
      setSelectedRouteIndex(0);
    } catch (error) {
      console.error("Error calculating route:", error);
      setSuggestedRoutes(["Error calculating route. Please try again."]);
    }
  };

  useEffect(() => {
    console.log("AWS Route Data:", awsRouteData); // Debug log
  
    if (awsRouteData && suggestedRoutes.length > 0) {
      const snapped = buildSnappedRouteData(awsRouteData, transitRoute.features);
      setTimeout(() => {
        navigate("/route-breakdown", {
          state: {
            origin,
            destination,
            suggestedRoutes,
            selectedRouteIndex: 0,
            awsRouteData,
            snappedRouteData: snapped,
          },
        });
      }, 100); // slight delay to ensure state updates
    }
  }, [awsRouteData, suggestedRoutes, origin, destination, navigate]);
  

  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backdropFilter: "blur(4px)",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            textAlign: "center",
            color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            padding: "32px",
            borderRadius: "5px",
            minWidth: "360px",
            maxWidth: "90%",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <img
              src={logo}
              alt="Logo"
              style={{ width: "40px", height: "40px", cursor: "pointer" }}
              onClick={() => navigate("/")}
            />
            <button
              onClick={() => navigate("/map-view")}
              style={{
                padding: "8px 12px",
                backgroundColor: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Map View
            </button>
          </div>

          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "48px" }}>
            Route Navigator
          </h1>

          <div style={{ display: "flex", gap: "5px" }}>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              style={{
                marginBottom: "20px",
                padding: "10px",
                borderRadius: "5px",
                border: "none",
                width: "300px",
                maxWidth: "90%",
              }}
            >
              <option value="">Select Origin</option>
              <option value="14.476337,121.039364">14.476337, 121.039364</option>
              <option value="14.465414,121.018648">14.465414, 121.018648</option>
              <option value="14.557837,121.007813">14.557837, 121.007813</option>
            </select>

            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              style={{
                marginBottom: "20px",
                padding: "10px",
                borderRadius: "5px",
                border: "none",
                width: "300px",
                maxWidth: "90%",
              }}
            >
              <option value="">Select Destination</option>
              <option value="14.536381,120.988745">14.536381, 120.988745</option>
              <option value="14.552608,121.050117">14.552608, 121.050117</option>
              <option value="14.485168,121.039827">14.485168, 121.039827</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "20px", gap: "10px" }}>
            <button
              onClick={handleRouteSuggestion}
              style={{
                width: "150px",
                height: "50px",
                backgroundColor: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              Suggest Routes
            </button>

            <div style={{ marginTop: "20px", fontSize: "1.1rem" }}>
              {suggestedRoutes.length > 0 ? (
                <div style={{ fontSize: "1.2rem", fontWeight: "bold" }}>
                  {suggestedRoutes[0]}
                </div>
              ) : (
                <div>Loading...</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NavView;
