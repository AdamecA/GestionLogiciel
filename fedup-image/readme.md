installer fedup
lien : https://github.com/GDD-Nantes/fedup/tree/fix_summarizer_tdb2%2311
mvn package clean

créer les .nq
se mettre dans apache-jena-5.6.0 -> bin
./riot --output=nquads ../../h1.ttl > ../../h1.nq

modifier pour rajouter la quatrieme valeur avec gpt

ensuite créer la base tdb2
./tdb2.tdbloader --loc ../../tdb2base/ ../../h1.nq ../../h2.nq

tester le tdb2 avec
./tdb2.tdbquery --loc ../../tdb2base/ --query=../../test.rq

'''test.rq'''
SELECT ?s ?p ?o
WHERE {
GRAPH <http://example.org/graph/h2> { ?s ?p ?o }
} LIMIT 10

'''

executer le summarizer de fedup
dans le dossier fedup faire : java -jar target/summarizer.jar --input=../tdb2base/ --output=../tdb2summary/ 


attention : créer le fichier output avant -> erreur


push image fedup: 


docker build . --tag fedup-capstone:v10
docker tag fedup-capstone:v10 aadamec/fedup-capstone:v10
docker push aadamec/fedup-capstone:v10



test avec : 

SELECT ?s ?p ?o
WHERE {
?s ?p ?o .
}


