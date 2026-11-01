# ── Build stage ───────────────────────────────────────────────────────────────
# Resolve dependencies before copying source so that the dependency layer is
# cached and only re-downloaded when pom.xml changes.
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline -q
COPY src ./src
RUN mvn package -DskipTests -q

# ── Runtime stage ─────────────────────────────────────────────────────────────
# JRE-only image — build tools and Maven are not present at runtime.
FROM eclipse-temurin:17-jre AS runtime
RUN adduser --system --group appuser
WORKDIR /app
COPY --from=builder /build/target/*.jar app.jar
USER appuser
EXPOSE 8020
ENTRYPOINT ["java", "-jar", "app.jar"]
