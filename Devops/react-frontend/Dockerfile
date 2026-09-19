FROM node:18-alpine as build
COPY . .
RUN npm install --legacy-peer-deps
RUN npm run build

FROM node:18-alpine as release
COPY --from=build /build ./build
RUN npm install -g serve \
    && adduser -S appuser -G node
USER appuser
EXPOSE 3000
CMD [ "serve", "-s", "build" ]