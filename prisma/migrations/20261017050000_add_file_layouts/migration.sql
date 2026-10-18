-- A file object carries its own layout (Anytype I.ObjectLayout: File = 6, Image = 8,
-- Audio = 15, Video = 16, Pdf = 20). The bytes live on the file store keyed by the
-- object id; the layout only tells the shell how to render the record. Additive:
-- existing rows keep their current enum value.
ALTER TYPE "ObjectLayout" ADD VALUE 'file';
ALTER TYPE "ObjectLayout" ADD VALUE 'image';
ALTER TYPE "ObjectLayout" ADD VALUE 'audio';
ALTER TYPE "ObjectLayout" ADD VALUE 'video';
ALTER TYPE "ObjectLayout" ADD VALUE 'pdf';
