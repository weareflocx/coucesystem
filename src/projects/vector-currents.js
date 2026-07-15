import { flowAdvectionRenderer } from "./flow-advection.js";

export const vectorCurrentsProject = {
  ...flowAdvectionRenderer,
  id: "vector-currents",
  index: "02",
  name: "Vector Currents",
  label: "Cauce — Vector Currents",
  description: "Masas de energía periódicas atraviesan una retícula fija gobernada por un campo incompresible."
};
