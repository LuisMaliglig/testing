//distance:
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in kilometers
  return distance;
}


//jeep-fare:
function calculateFare(distance) {
  const minimumFare = 13; // pesos
  const freeKilometers = 4;
  const additionalFarePerKm = 1.8;

  let fare;

  // If the distance is less than or equal to 4 km, the fare is 13 pesos
  if (distance <= freeKilometers) {
    fare = minimumFare;
  } else {
    // Calculate additional fare for kilometers beyond 4 km
    const extraKilometers = distance - freeKilometers;
    fare = minimumFare + Math.ceil(extraKilometers * additionalFarePerKm);
  }

  return fare;
}

//implementation:
// Sample coordinates for two points
const lat1 = 14.5995;
const lon1 = 120.9842; // Starting point (Manila)
const lat2 = 14.5358;
const lon2 = 120.9950; // Ending point (Baclaran Church)

// Calculate distance
const distance = calculateDistance(lat1, lon1, lat2, lon2);

// Calculate fare
const fare = calculateFare(distance);

console.log(`Distance: ${distance.toFixed(2)} km`);
console.log(`Estimated Fare: ₱${fare}`);
