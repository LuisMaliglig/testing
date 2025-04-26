import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocationClient, SearchPlaceIndexForTextCommand } from "@aws-sdk/client-location";
import { awsConfig } from "../config/config"; // Ensure AWS config is available
import logo from '../assets/logo.png'; // Ensure logo is imported

const NavView = () => {
  const mapContainerRef = useRef(null);
  const [isMapVisible, setIsMapVisible] = useState(true);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [suggestedLocations, setSuggestedLocations] = useState([]);
  const [map, setMap] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMapVisible) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.03570371941494, 14.49812611353759], // Default to Manila
      zoom: 11,
    });

    setMap(mapInstance);

    mapInstance.on("load", () => {
      setMapLoaded(true);

      // Add the central marker
      const marker = new maplibregl.Marker({ color: "#ff0000" })
        .setLngLat([121.03570371941494, 14.49812611353759]) // Centered on Manila
        .addTo(mapInstance);

      // Add compass and ruler controls
      mapInstance.addControl(new maplibregl.NavigationControl(), "bottom-right");
    });

    return () => mapInstance.remove();
  }, [isMapVisible]);

  const handleLocationSearch = async (query, type) => {
    if (!query) {
      setSuggestedLocations([]);
      return;
    }

    const client = new LocationClient({
      region: awsConfig.region,
      credentials: awsConfig.credentials,
    });

    const command = new SearchPlaceIndexForTextCommand({
      IndexName: awsConfig.placeIndex, // AWS Place Index
      Text: query,
    });

    try {
      const response = await client.send(command);
      const locations = response.Results.map(result => ({
        id: result.Place.Geometry.Point.join(", "),
        name: result.Place.Label,
      }));

      if (type === "origin") {
        setOrigin(locations[0]);
      } else {
        setDestination(locations[0]);
      }

      setSuggestedLocations(locations);
    } catch (error) {
      console.error("Error searching for locations:", error);
    }
  };

  const handleSetOrigin = (location) => {
    setOrigin(location);
    map.flyTo({ center: location.id.split(", ").map(Number), zoom: 12 });
  };

  const handleSetDestination = (location) => {
    setDestination(location);
    map.flyTo({ center: location.id.split(", ").map(Number), zoom: 12 });
  };

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      {/* Sidebar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: "300px",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          color: "white",
          padding: "16px",
          zIndex: 10,
        }}
      >
        {/* Top-left logo and Map View button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          {/* Home button (Logo) */}
          <img
            src={logo}
            alt="Logo"
            style={{ width: "40px", height: "40px", cursor: "pointer" }}
            onClick={() => navigate("/")}
          />
          
          {/* Map View button */}
          <button
            onClick={() => navigate("/map-view")}
            style={{
              padding: "10px 16px",
              backgroundColor: "#1e40af",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            Map View
          </button>
        </div>

        <h2 style={{ marginBottom: "16px" }}>Navigation</h2>

        {/* Origin */}
        <div style={{ marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Search for origin..."
            onChange={(e) => handleLocationSearch(e.target.value, "origin")}
            style={{
              width: "90%",
              padding: "10px 16px",
              marginBottom: "8px",
              borderRadius: "15px", // Rounded corners for input
              border: "1px solid #1e40af",
              backgroundColor: "#fff",
              color: "#333",
            }}
          />
          {origin && <div><strong>Origin:</strong> {origin.name}</div>}
        </div>

        {/* Destination */}
        <div style={{ marginBottom: "16px" }}>
          <input
            type="text"
            placeholder="Search for destination..."
            onChange={(e) => handleLocationSearch(e.target.value, "destination")}
            style={{
              width: "90%",
              padding: "10px 16px",
              marginBottom: "8px",
              borderRadius: "15px", // Rounded corners for input
              border: "1px solid #1e40af",
              backgroundColor: "#fff",
              color: "#333",
            }}
          />
          {destination && <div><strong>Destination:</strong> {destination.name}</div>}
        </div>

        {/* Suggested Locations */}
        <div>
          <h3>Suggested Locations</h3>
          <ul style={{ paddingLeft: "0", listStyle: "none" }}>
            {suggestedLocations.map((location, index) => (
              <li key={index} style={{ marginBottom: "8px" }}>
                <button
                  onClick={() => handleSetOrigin(location)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    backgroundColor: "#1e40af",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px", // Rounded corners for buttons
                    cursor: "pointer",
                    marginBottom: "4px",
                  }}
                >
                  Set as Origin: {location.name}
                </button>
                <button
                  onClick={() => handleSetDestination(location)}
                  style={{
                    width: "100%",
                    padding: "10px",
                    backgroundColor: "#1e40af",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px", // Rounded corners for buttons
                    cursor: "pointer",
                  }}
                >
                  Set as Destination: {location.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Fullscreen map container */}
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
      />
    </div>
  );
};

export default NavView;
