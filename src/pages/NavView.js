import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import transitRoute from "../data/transit-lines.json";
import { useNavigate } from "react-router-dom";
import AWS from 'aws-sdk';
import logo from "../assets/logo.png"; // Make sure to import your logo

const NavView = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [suggestedRoutes, setSuggestedRoutes] = useState([]);
  const navigate = useNavigate();

  // Configure AWS SDK
  AWS.config.update({
    region: awsConfig.region,
    accessKeyId: awsConfig.accessKeyId,
    secretAccessKey: awsConfig.secretAccessKey,
  });

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
      setSuggestedRoutes(["Please provide valid origin and destination coordinates."]);
      return;
    }

    const originCoords = origin.split(",").map(Number);
    const destinationCoords = destination.split(",").map(Number);

    const params = {
      CalculatorName: awsConfig.routeCalculatorName,
      DeparturePosition: [originCoords[1], originCoords[0]], // [longitude, latitude]
      DestinationPosition: [destinationCoords[1], destinationCoords[0]],
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
    <div style={{ position: "relative", height: "100vh" }}>
      {/* Fullscreen map container */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />

      {/* Main Content Area */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backdropFilter: "blur(4px)",
        backgroundColor: "rgba(0, 0, 0, 0.2)",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          position: "relative",
          textAlign: "center",
          color: "white",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          padding: "32px",
          borderRadius: "15px",
          minWidth: "360px",
          maxWidth: "90%",
        }}>
          {/* Logo and Map View button inside the card */}
          <div style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            display: "flex",
            alignItems: "space-between",
            gap: "12px",
          }}>
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
                borderRadius: "12px",
                cursor: "pointer",
              }}
            >
              Map View
            </button>
          </div>

          {/* Main Title */}
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "48px" }}>Route Navigator</h1>

          {/* Inputs */}
          <input
            type="text"
            placeholder="Origin (latitude,longitude)"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            style={{
              marginBottom: "20px",
              padding: "10px",
              borderRadius: "15px",
              border: "none",
              width: "300px",
              maxWidth: "90%",
            }}
          />
          <input
            type="text"
            placeholder="Destination (latitude,longitude)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            style={{
              marginBottom: "20px",
              padding: "10px",
              borderRadius: "15px",
              border: "none",
              width: "300px",
              maxWidth: "90%",
            }}
          />

          {/* Suggest Routes button */}
          <button
            onClick={handleRouteSuggestion}
            style={{
              width: "150px",
              height: "50px",
              backgroundColor: "#1e40af",
              color: "#fff",
              border: "none",
              borderRadius: "15px",
              cursor: "pointer",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: "1rem",
            }}
          >
            Suggest Routes
          </button>

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
