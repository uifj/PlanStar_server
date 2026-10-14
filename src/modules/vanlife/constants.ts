// A fixed id is what makes "one shared VanLife space" idempotent: nobody has to
// find it by name, and two concurrent requests cannot create two of them.
export const VAN_LIFE_SPACE_ID = "vanlife-space";

export const VAN_LIFE_SPACE_NAME = "VanLife";
