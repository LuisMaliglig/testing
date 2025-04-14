import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocationClient, CalculateRouteCommand } from "@aws-sdk/client-location";
import transitRoute from "./transit-lines.json";
import { awsConfig } from "./config";

const Map = () => {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.03570371941494, 14.49812611353759], // Default center: Manila
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      setMapLoaded(true);

      // Add transit route overlay
      map.addSource("transit-route", {
        type: "geojson",
        data: transitRoute,
      });

      // MRT Line - Yellow
      map.addLayer({
        id: "mrt-line",
        type: "line",
        source: "transit-route",
        filter: ["==", ["get", "type"], "MRT"],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#facc15", // Yellow (Tailwind's yellow-400)
          "line-width": 4,
        },
      });

      // LRT Line - Green
      map.addLayer({
        id: "lrt-line",
        type: "line",
        source: "transit-route",
        filter: ["==", ["get", "type"], "LRT"],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#22c55e", // Green (Tailwind's green-500)
          "line-width": 4,
        },
      });
      map.addLayer({
        id: "jeep-lines",
        type: "line",
        source: "transit-route",
        filter: ["==", ["get", "type"], "Jeep"],
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        "paint": {
          "line-color": "#FFA500", // Orange color
          "line-width": 3
        }
      });
    });

    return () => map.remove();
  }, []);

  const getRoute = async () => {
    const client = new LocationClient({
      region: awsConfig.region,
      credentials: awsConfig.credentials, // Optional if using API Key
    });

    const command = new CalculateRouteCommand({
      CalculatorName: awsConfig.routeCalculator,
      DeparturePosition: [120.9820, 14.6042], // Example: SM Manila
      DestinationPosition: [120.9950, 14.5358], // Example: Baclaran Church
      TravelMode: "Car",
      DistanceUnit: "Kilometers",
    });

    try {
      const response = await client.send(command);
      const routeLine = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: response.Legs.flatMap(leg =>
            leg.Steps.map(step => step.EndPosition)
          ),
        },
      };

      // Add route layer
      if (mapRef.current.getSource("calculated-route")) {
        mapRef.current.getSource("calculated-route").setData(routeLine);
      } else {
        mapRef.current.addSource("calculated-route", {
          type: "geojson",
          data: routeLine,
        });

        mapRef.current.addLayer({
          id: "calculated-route-line",
          type: "line",
          source: "calculated-route",
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#22c55e", // Green for route
            "line-width": 4,
          },
        });
      }
    } catch (err) {
      console.error("Error getting route:", err);
    }
  };

  return (
    <div>
      <button
        onClick={getRoute}
        disabled={!mapLoaded}
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          padding: "8px 12px",
          backgroundColor: "#1e40af",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
        }}
      >
        Get Route
      </button>
      <div ref={mapContainerRef} style={{ width: "100%", height: "500px" }} />
    </div>
  );
};

export default Map;
