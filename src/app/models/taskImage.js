module.exports = (sequelize, DataTypes) => {
  const TaskImage = sequelize.define("taskImage", {
    imageUrl: { type: DataTypes.STRING },
    featured: { type: DataTypes.BOOLEAN }
  }, {
    tableName: "taskImage"
  });

  TaskImage.associate = models => {
    TaskImage.belongsTo(models.task);
  };

  return TaskImage;
};