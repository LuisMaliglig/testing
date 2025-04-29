import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json";
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png"; // Make sure to import your logo

const NavView = () => {
  const [awsReady, setAwsReady] = useState(false);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [suggestedRoutes, setSuggestedRoutes] = useState([]);
  const navigate = useNavigate();

  // Configure AWS SDK
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
  

  const routeCalculator = new AWS.Location();

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      map.addSource("transit-route", {
        type: "geojson",
        data: transitRoute,
      });

      // Add your route layers here if needed
    });

    return () => map.remove();
  }, []);

  const handleRouteSuggestion = async () => {
    if (!origin || !destination) {
      setSuggestedRoutes(["Please select valid origin and destination."]);
      return;
    }
  
    // If credentials aren't ready yet, wait
    if (!AWS.config.credentials || !AWS.config.credentials.accessKeyId) {
      console.log("AWS credentials not yet available.");
      setSuggestedRoutes(["AWS credentials not yet available. Please try again."]);
      return;
    }
  
    const originCoords = origin.split(",").map(Number);
    const destinationCoords = destination.split(",").map(Number);
  
    const routeCalculator = new AWS.Location();
  
    const params = {
      CalculatorName: awsConfig.routeCalculatorName,
      DeparturePosition: [originCoords[1], originCoords[0]], // [lon, lat]
      DestinationPosition: [destinationCoords[1], destinationCoords[0]], // [lon, lat]
    };
  
    try {
      const data = await routeCalculator.calculateRoute(params).promise();
      const routes = data.Legs.map((leg, index) => {
        return `Route ${index + 1}: ${(leg.Distance).toFixed(2)} km, ${(leg.DurationSeconds / 60).toFixed(1)} mins`;
      });
      setSuggestedRoutes(routes);
    } catch (error) {
      console.error("Error calculating route:", error);
      setSuggestedRoutes(["Error calculating route. Please try again."]);
    }
  };

  return (
    <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif"  }}>
      {/* Fullscreen map container */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
  
      {/* Main Content Area */}
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
          {/* Logo and Map View button inside the card */}
          <div
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              display: "flex",
              alignItems: "space-between",
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
                fontFamily: "Montserrat, sans-serif"
              }}
            >
              Map View
            </button>
          </div>
  
          {/* Main Title */}
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "48px" }}>
            Route Navigator
          </h1>
  
          {/* Inputs */}
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
                fontFamily: "Montserrat, sans-serif"
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
                fontFamily: "Montserrat, sans-serif"
              }}
            >
              <option value="">Select Destination</option>
              <option value="14.536381,120.988745">14.536381, 120.988745</option>
              <option value="14.552608,121.050117">14.552608, 121.050117</option>
              <option value="14.485168,121.039827">14.485168, 121.039827</option>
            </select>
          </div>

          {/* Centered Suggest Routes button */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
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
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontSize: "1rem",
                fontFamily: "Montserrat, sans-serif"
              }}
            >
              Suggest Routes
            </button>
          </div>
  
          {/* Suggested Routes List */}
          <div style={{ marginTop: "20px", color: "white" }}>
            {suggestedRoutes.length > 0 ? (
              suggestedRoutes.map((route, index) => (
                <div key={index}>{route}</div>
              ))
            ) : (
              <div>No routes suggested yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
  
};

export default NavView;
