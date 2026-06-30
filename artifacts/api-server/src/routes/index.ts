import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import menuRouter from "./menu";
import inventoryRouter from "./inventory";
import ordersRouter from "./orders";
import tablesRouter from "./tables";
import loyaltyRouter from "./loyalty";
import dashboardRouter from "./dashboard";
import publicRouter from "./public";
import equipmentRouter from "./equipment";
import wasteRouter from "./waste";
import staffRouter from "./staff";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(menuRouter);
router.use(inventoryRouter);
router.use(ordersRouter);
router.use(tablesRouter);
router.use(loyaltyRouter);
router.use(dashboardRouter);
router.use("/public", publicRouter);
router.use(equipmentRouter);
router.use(wasteRouter);
router.use(staffRouter);

export default router;
