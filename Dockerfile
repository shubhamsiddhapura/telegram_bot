# Use the official Node.js 20 image (Debian-based for better compatibility with Baileys dependencies)
FROM node:20-slim

# Install system dependencies needed for some Node modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files first for better caching
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy the rest of the application code
COPY . .

# Expose the port (Render uses PORT env var, but we'll expose 3000 as default)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
