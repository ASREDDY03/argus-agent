FROM eclipse-temurin:17-jre
ARG JAR_FILE=target/*.jar
COPY ${JAR_FILE} app.jar
RUN adduser --system --group appuser
USER appuser
EXPOSE 8020
ENTRYPOINT ["java", "-jar", "/app.jar"]
