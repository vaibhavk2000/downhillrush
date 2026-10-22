# Use the official lightweight Node.js image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first to leverage Docker layer caching
COPY package*.json ./

# Install production dependencies (or npm install if you need devDependencies too)
RUN npm install --production

# Copy the rest of the application source code
COPY . .

# Expose the port your server runs on (change 3000 if your server.js uses a different port)
EXPOSE 3000

# Define the command to run your application
CMD ["node", "server.js"]
