FROM eclipse-temurin:21-jdk-jammy

WORKDIR /app

COPY fedup/target/fedup.jar /app/fedup.jar
COPY fedup/target/fedup-server.jar /app/fedup-server.jar
COPY tdb2summary /app/tdb2summary

EXPOSE 3330

CMD ["java", "-jar", "fedup-server.jar", \
    "--engine=FedX", \
    "--port=3330", \
    "--summaries=tdb2summary", \
    "--modify=(e) -> \"http://forward-proxy:8888/\"+e"]
