-- `neurite_soma_classical` left the picker: no project type may select it, so a
-- project still storing it would resolve to the type's default, `neurite_soma`.
-- That is the wrong model for these projects. They chose classical because their
-- cells show across several channels, and `neurite_soma` reads one: on 15
-- expert-corrected frames of this kind it scored Dice 0.622 neurite / 0.834 soma
-- against 0.843 / 0.879 for `neurite_soma_merged`, the model replacing classical.
--
-- Only the setting moves, for future runs. Stored segmentations keep the model
-- that produced them. `updatedAt` is left alone so project lists do not reorder.
-- Rows at NULL keep following the type's default.
--
-- Safe to re-run: after the first pass the WHERE matches nothing.
UPDATE "projects"
SET "segmentationModel" = 'neurite_soma_merged'
WHERE "segmentationModel" = 'neurite_soma_classical';
