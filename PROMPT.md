# Développement d'un moteur de physique 2D gérant des corps de type soft body

Je souhaite utiliser un moteur de physique en typescript gérant les corps de types soft bodies pour ensuite afficher ceux là avec via un canvas 2D.

La partie rendu n'est pas dans le scope de ce moteur physique.

L'inspiration principale de ce moteur est celui du jeu JellyCar, décrit en détails dans :

- Cette vidéo youtube: [Physics of JellyCar: Soft Body Physics Explained](https://www.youtube.com/watch?v=3OmkehAJoyo). La vidéo est disponible localement si besoin de l'analyser.
- L'article companion de la vidéo avec grosso modo le même contenu sous forme texte : [Deep Dive: The soft body physics of JellyCar, explained](https://www.gamedeveloper.com/programming/deep-dive-the-soft-body-physics-of-jelly-car-explained)
- Un résumé de la vidéo généré par Notebook LM : `./jellycar-physics-summary.md`

Resources additionelles secondaires :

- L'intégration des soft bodies dans la librairie Rapier : [Advanced soft-bodies for games with the Rapier physics engine](https://dimforge.com/blog/2026/09/25/advanced-soft-bodies-for-games-in-the-rapier-physics-engine/)
- Vidéo wireframe d'un système de blob similaire à celui que je souhaite implémenter : https://x.com/heytibo/status/2118678231197085855

## Fonctionnalités souhaitées

- Définition des bodies
  - Formes classiques : rectangle et cercle, comme l'helper Matter.Bodies
  - Formes arbitraires passées sous forme de points, comme Matter.Bodies.formVertices ou bien Matter.Bodies.polygon
  - Gestion de bodies composés
  - Gestion de bodies avec des "trous", par exemple une forme représentant la lettre "O" où le corp est un donut.
- Statique VS dynamique
  - Statique (ne sont pas impactés par le moteur physique)
  - Dynamiques
- Soft VS rigid
  - Rigid : Rigid Bodies classiques, à la matterjs
  - Soft : Deux familles
    - Pressurized : Utilise la technique de "Gas Giants" décrite dans la description de JellyCar.
    - Shape matching : Utilise la technique de "Shape Matching" décrite dans la description de JellyCar
- Détection et résolution de collision
- Boucle de rendu avec gestion du timestep indépendant du framerate

## Performances VS précision

Je cherche une lirairie qui est avant tout **performante**. Aussi bien en temps de chargement qu'en performance à l'usage. C'est pour cette raison que je ne souaite pas utiliser Rapier. Cette dernière est beaucoup trop lourde.

Comme son inspiration (JellyCar), la librairie n'a pas vocation à être une simulation physique précise et rigoureuse. On va tolérer des approximation physique à la faveur des performances.

La librairie sera utilisée pour des micro expériences web creatives.

## matter.js

Autre librairie envisagée : https://brm.io/matter-js/

J'ai auparavant utilisé matterjs pour simuler des blobs de type soft bodies (qui ne les gèrent pas de base) une combinaison de points et de springs.

Cette technique ne marche pas lorsque deux blobs rentrent en contact puisque ceux là n'ont pas de forme à proprement parler. Les seuls corps physiques sont les points ("vertices") formant le blob.
