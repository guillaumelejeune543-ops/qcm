créer bouton niveau difficulté qui modifie le prompt
-Optimisation iPad / mobile boutons plus larges swipe gauche / droite retour haptique léger (iPad)
reagrder si il y aune méthode d'avoir des tokens moins cher


rajoute des commentaires pour toutes les modfis que t'as faites depuis le début de cette discusiion(même supprimer) en prévision d'une fusion

Résumé des changements (à mettre dans la note de fusion)

Suppression du système “Marquer”

Retrait du bouton “Marquer”, des filtres “Marquées”, de la relance “marquées”, et du stockage flagged.
Nettoyage côté app.js, index.html, auth.js, styles.css.
Simplification des résultats

Retrait du “Score moyen” et de “Validées”.
Les métriques restantes sont centrées sur 3 cartes (Note/20, Temps total, Temps/question).
Suppression de l’export JSON

Retrait du bouton et de la logique d’export.
Tooltip mode

Ajout d’un bouton i avec infobulle expliquant Examen vs Entraînement.
Style soigné + 2 lignes.
Dropdowns custom (question count & timer seconds)

Input toujours éditable au clavier.
Menu déroulant propre (presets 10/20/30/40 et 30/60/90/120).
Fermeture au clic extérieur + petite animation d’ouverture.
Clamp des valeurs

Clamping au blur uniquement (ne gêne plus la saisie).
Max 40 pour questions, max 200 pour secondes.
Prompt IA amélioré pour randomisation

Ajout de contraintes pour mieux répartir nombre de bonnes réponses et lettres correctes.
